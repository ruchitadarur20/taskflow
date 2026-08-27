from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.auth.models import User
from app.domains.auth.security import utc_now
from app.domains.notifications.service import create_notification
from app.domains.projects.models import (
    ActivityEvent,
    Label,
    Project,
    ProjectStatus,
    Task,
    TaskComment,
    TaskDependency,
    TaskLabel,
    TaskPriority,
    TaskStatus,
)
from app.domains.workspaces.models import WorkspaceMember
from app.domains.workspaces.policies import WorkspaceAction, can
from app.domains.workspaces.service import require_permission
from app.realtime.events import queue_workspace_event


class ProjectError(Exception):
    pass


class ProjectNotFoundError(ProjectError):
    pass


class ProjectForbiddenError(ProjectError):
    pass


class ProjectArchivedError(ProjectError):
    pass


class TaskNotFoundError(ProjectError):
    pass


class InvalidAssignmentError(ProjectError):
    pass


class InvalidParentTaskError(ProjectError):
    pass


class InvalidDependencyError(ProjectError):
    pass


class DuplicateDependencyError(ProjectError):
    pass


class DuplicateLabelError(ProjectError):
    pass


class LabelNotFoundError(ProjectError):
    pass


class CommentNotFoundError(ProjectError):
    pass


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or "project"


def unique_project_slug(db: Session, workspace_id: uuid.UUID, name: str) -> str:
    base = slugify(name)
    slug = base
    suffix = 2
    while (
        db.scalar(
            select(Project.id).where(Project.workspace_id == workspace_id, Project.slug == slug)
        )
        is not None
    ):
        slug = f"{base}-{suffix}"
        suffix += 1
    return slug


def record_activity(
    db: Session,
    *,
    workspace_id: uuid.UUID,
    actor_id: uuid.UUID | None,
    event_type: str,
    project_id: uuid.UUID | None = None,
    task_id: uuid.UUID | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    occurred_at = utc_now()
    db.add(
        ActivityEvent(
            workspace_id=workspace_id,
            project_id=project_id,
            task_id=task_id,
            actor_id=actor_id,
            event_type=event_type,
            metadata_json=metadata or {},
            created_at=occurred_at,
        )
    )
    queue_workspace_event(
        db,
        workspace_id=workspace_id,
        event_type=event_type,
        project_id=project_id,
        task_id=task_id,
        actor_id=actor_id,
        occurred_at=occurred_at,
        metadata=metadata or {},
    )


def require_read_membership(db: Session, workspace_id: uuid.UUID, user: User) -> WorkspaceMember:
    return require_permission(db, workspace_id, user, WorkspaceAction.view)


def require_write_membership(db: Session, workspace_id: uuid.UUID, user: User) -> WorkspaceMember:
    return require_permission(db, workspace_id, user, WorkspaceAction.write_project_content)


def get_project(db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID) -> Project:
    project = db.scalar(
        select(Project).where(Project.id == project_id, Project.workspace_id == workspace_id)
    )
    if project is None:
        raise ProjectNotFoundError
    return project


def require_active_project(db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID) -> Project:
    project = get_project(db, workspace_id, project_id)
    if project.status == ProjectStatus.archived:
        raise ProjectArchivedError
    return project


def create_project(
    db: Session,
    workspace_id: uuid.UUID,
    actor: User,
    *,
    name: str,
    description: str | None,
) -> Project:
    require_write_membership(db, workspace_id, actor)
    now = utc_now()
    project = Project(
        workspace_id=workspace_id,
        created_by_id=actor.id,
        name=name.strip(),
        description=description,
        slug=unique_project_slug(db, workspace_id, name),
        status=ProjectStatus.active,
        created_at=now,
        updated_at=now,
    )
    db.add(project)
    db.flush()
    record_activity(
        db,
        workspace_id=workspace_id,
        project_id=project.id,
        actor_id=actor.id,
        event_type="project.created",
        metadata={"name": project.name},
    )
    db.commit()
    db.refresh(project)
    return project


def list_projects(db: Session, workspace_id: uuid.UUID, actor: User) -> list[Project]:
    require_read_membership(db, workspace_id, actor)
    return list(
        db.scalars(
            select(Project)
            .where(Project.workspace_id == workspace_id, Project.status == ProjectStatus.active)
            .order_by(Project.created_at)
        )
    )


def get_project_for_user(
    db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID, actor: User
) -> Project:
    require_read_membership(db, workspace_id, actor)
    return get_project(db, workspace_id, project_id)


def update_project(
    db: Session,
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    actor: User,
    *,
    name: str | None,
    description: str | None,
) -> Project:
    require_write_membership(db, workspace_id, actor)
    project = require_active_project(db, workspace_id, project_id)
    changes: dict[str, object] = {}
    if name is not None and project.name != name.strip():
        changes["name"] = {"old": project.name, "new": name.strip()}
        project.name = name.strip()
    if description is not None and project.description != description:
        changes["description"] = {"old": project.description, "new": description}
        project.description = description
    if changes:
        project.updated_at = utc_now()
        record_activity(
            db,
            workspace_id=workspace_id,
            project_id=project.id,
            actor_id=actor.id,
            event_type="project.updated",
            metadata=changes,
        )
    db.commit()
    db.refresh(project)
    return project


def archive_project(
    db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID, actor: User
) -> None:
    require_write_membership(db, workspace_id, actor)
    project = require_active_project(db, workspace_id, project_id)
    now = utc_now()
    project.status = ProjectStatus.archived
    project.archived_at = now
    project.updated_at = now
    record_activity(
        db,
        workspace_id=workspace_id,
        project_id=project.id,
        actor_id=actor.id,
        event_type="project.archived",
    )
    db.commit()


def require_assignable_user(
    db: Session, workspace_id: uuid.UUID, assignee_id: uuid.UUID | None
) -> None:
    if assignee_id is None:
        return
    membership = db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == assignee_id,
        )
    )
    if membership is None:
        raise InvalidAssignmentError


def get_task(
    db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID, task_id: uuid.UUID
) -> Task:
    task = db.scalar(
        select(Task).where(
            Task.id == task_id,
            Task.workspace_id == workspace_id,
            Task.project_id == project_id,
        )
    )
    if task is None:
        raise TaskNotFoundError
    return task


def parent_chain_contains(db: Session, task_id: uuid.UUID, candidate_parent_id: uuid.UUID) -> bool:
    current = db.get(Task, candidate_parent_id)
    while current is not None:
        if current.parent_task_id == task_id:
            return True
        current = db.get(Task, current.parent_task_id) if current.parent_task_id else None
    return False


def validate_parent(
    db: Session,
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    task_id: uuid.UUID | None,
    parent_task_id: uuid.UUID | None,
) -> None:
    if parent_task_id is None:
        return
    if task_id is not None and task_id == parent_task_id:
        raise InvalidParentTaskError
    parent = get_task(db, workspace_id, project_id, parent_task_id)
    if parent.archived_at is not None:
        raise InvalidParentTaskError
    if task_id is not None and parent_chain_contains(db, task_id, parent_task_id):
        raise InvalidParentTaskError


def create_task(
    db: Session,
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    actor: User,
    *,
    title: str,
    description: str | None,
    status: TaskStatus,
    priority: TaskPriority,
    assignee_id: uuid.UUID | None,
    due_at: datetime | None,
    parent_task_id: uuid.UUID | None,
) -> Task:
    require_write_membership(db, workspace_id, actor)
    require_active_project(db, workspace_id, project_id)
    require_assignable_user(db, workspace_id, assignee_id)
    validate_parent(db, workspace_id, project_id, None, parent_task_id)
    now = utc_now()
    task = Task(
        workspace_id=workspace_id,
        project_id=project_id,
        parent_task_id=parent_task_id,
        created_by_id=actor.id,
        assignee_id=assignee_id,
        title=title.strip(),
        description=description,
        status=status,
        priority=priority,
        due_at=due_at,
        created_at=now,
        updated_at=now,
    )
    db.add(task)
    db.flush()
    record_activity(
        db,
        workspace_id=workspace_id,
        project_id=project_id,
        task_id=task.id,
        actor_id=actor.id,
        event_type="task.created",
        metadata={"title": task.title},
    )
    db.commit()
    db.refresh(task)
    return task


def list_tasks(
    db: Session,
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    actor: User,
    *,
    status: TaskStatus | None = None,
    assignee_id: uuid.UUID | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[Task]:
    require_read_membership(db, workspace_id, actor)
    get_project(db, workspace_id, project_id)
    query = select(Task).where(
        Task.workspace_id == workspace_id,
        Task.project_id == project_id,
        Task.archived_at.is_(None),
    )
    if status is not None:
        query = query.where(Task.status == status)
    if assignee_id is not None:
        query = query.where(Task.assignee_id == assignee_id)
    return list(db.scalars(query.order_by(Task.created_at).limit(limit).offset(offset)))


def update_task(
    db: Session,
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    actor: User,
    **updates: object,
) -> Task:
    require_write_membership(db, workspace_id, actor)
    task = get_task(db, workspace_id, project_id, task_id)
    if task.archived_at is not None:
        raise TaskNotFoundError
    assignee_id = updates.get("assignee_id")
    if isinstance(assignee_id, uuid.UUID) or assignee_id is None:
        require_assignable_user(db, workspace_id, assignee_id)
    parent_task_id = updates.get("parent_task_id")
    if isinstance(parent_task_id, uuid.UUID) or parent_task_id is None:
        validate_parent(db, workspace_id, project_id, task.id, parent_task_id)
    changes: dict[str, object] = {}
    for field in (
        "title",
        "description",
        "status",
        "priority",
        "assignee_id",
        "due_at",
        "parent_task_id",
    ):
        if field in updates:
            next_value = updates[field]
            if field == "title" and isinstance(next_value, str):
                next_value = next_value.strip()
            if getattr(task, field) != next_value:
                changes[field] = {"old": str(getattr(task, field)), "new": str(next_value)}
                setattr(task, field, next_value)
    if changes:
        task.updated_at = utc_now()
        event_type = "task.updated"
        if "status" in changes:
            event_type = "task.status_changed"
        elif "assignee_id" in changes:
            event_type = "task.assignee_changed"
        elif "due_at" in changes:
            event_type = "task.due_date_changed"
        record_activity(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
            task_id=task.id,
            actor_id=actor.id,
            event_type=event_type,
            metadata=changes,
        )
        new_assignee_id = task.assignee_id
        assignee_notifiable = new_assignee_id is not None and new_assignee_id != actor.id
        if "assignee_id" in changes and assignee_notifiable:
            assert new_assignee_id is not None
            create_notification(
                db,
                user_id=new_assignee_id,
                workspace_id=workspace_id,
                notification_type="task.assignee_changed",
                title=f"You were assigned to {task.title}",
                project_id=project_id,
                task_id=task.id,
                actor_id=actor.id,
            )
        elif "status" in changes and assignee_notifiable:
            assert new_assignee_id is not None
            create_notification(
                db,
                user_id=new_assignee_id,
                workspace_id=workspace_id,
                notification_type="task.status_changed",
                title=f"Task status changed: {task.title}",
                body=str(task.status),
                project_id=project_id,
                task_id=task.id,
                actor_id=actor.id,
            )
    db.commit()
    db.refresh(task)
    return task


def archive_task(
    db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID, task_id: uuid.UUID, actor: User
) -> None:
    require_write_membership(db, workspace_id, actor)
    task = get_task(db, workspace_id, project_id, task_id)
    if task.archived_at is None:
        now = utc_now()
        task.status = TaskStatus.archived
        task.archived_at = now
        task.updated_at = now
        record_activity(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
            task_id=task.id,
            actor_id=actor.id,
            event_type="task.archived",
        )
        db.commit()


def dependency_path_exists(db: Session, start_id: uuid.UUID, target_id: uuid.UUID) -> bool:
    frontier = [start_id]
    seen: set[uuid.UUID] = set()
    while frontier:
        current = frontier.pop()
        if current == target_id:
            return True
        if current in seen:
            continue
        seen.add(current)
        next_ids = db.scalars(
            select(TaskDependency.blocked_task_id).where(
                TaskDependency.blocking_task_id == current
            )
        ).all()
        frontier.extend(next_ids)
    return False


def add_dependency(
    db: Session,
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    blocked_task_id: uuid.UUID,
    actor: User,
    blocking_task_id: uuid.UUID,
) -> TaskDependency:
    require_write_membership(db, workspace_id, actor)
    blocked = get_task(db, workspace_id, project_id, blocked_task_id)
    blocking = get_task(db, workspace_id, project_id, blocking_task_id)
    if blocked.id == blocking.id:
        raise InvalidDependencyError
    existing = db.get(TaskDependency, (blocking_task_id, blocked_task_id))
    if existing is not None:
        raise DuplicateDependencyError
    if dependency_path_exists(db, blocked_task_id, blocking_task_id):
        raise InvalidDependencyError
    dependency = TaskDependency(
        blocking_task_id=blocking_task_id,
        blocked_task_id=blocked_task_id,
        created_at=utc_now(),
    )
    db.add(dependency)
    record_activity(
        db,
        workspace_id=workspace_id,
        project_id=project_id,
        task_id=blocked_task_id,
        actor_id=actor.id,
        event_type="task.dependency_added",
        metadata={"blocking_task_id": str(blocking_task_id)},
    )
    db.commit()
    return dependency


def list_dependencies(
    db: Session,
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    actor: User,
) -> list[TaskDependency]:
    require_read_membership(db, workspace_id, actor)
    get_task(db, workspace_id, project_id, task_id)
    return list(db.scalars(select(TaskDependency).where(TaskDependency.blocked_task_id == task_id)))


def create_label(
    db: Session,
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    actor: User,
    *,
    name: str,
    color: str,
) -> Label:
    require_write_membership(db, workspace_id, actor)
    require_active_project(db, workspace_id, project_id)
    existing = db.scalar(
        select(Label).where(Label.project_id == project_id, Label.name == name.strip())
    )
    if existing is not None:
        raise DuplicateLabelError
    now = utc_now()
    label = Label(
        workspace_id=workspace_id,
        project_id=project_id,
        name=name.strip(),
        color=color,
        created_at=now,
        updated_at=now,
    )
    db.add(label)
    db.commit()
    db.refresh(label)
    return label


def list_labels(
    db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID, actor: User
) -> list[Label]:
    require_read_membership(db, workspace_id, actor)
    get_project(db, workspace_id, project_id)
    return list(
        db.scalars(select(Label).where(Label.project_id == project_id).order_by(Label.name))
    )


def add_label_to_task(
    db: Session,
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    actor: User,
    label_id: uuid.UUID,
) -> list[Label]:
    require_write_membership(db, workspace_id, actor)
    task = get_task(db, workspace_id, project_id, task_id)
    label = db.scalar(
        select(Label).where(
            Label.id == label_id,
            Label.workspace_id == workspace_id,
            Label.project_id == project_id,
        )
    )
    if label is None:
        raise LabelNotFoundError
    if db.get(TaskLabel, (task.id, label.id)) is None:
        db.add(TaskLabel(task_id=task.id, label_id=label.id, created_at=utc_now()))
        record_activity(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
            task_id=task.id,
            actor_id=actor.id,
            event_type="task.label_added",
            metadata={"label_id": str(label.id)},
        )
        db.commit()
    return list_task_labels(db, workspace_id, project_id, task_id, actor)


def remove_label_from_task(
    db: Session,
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    actor: User,
    label_id: uuid.UUID,
) -> None:
    require_write_membership(db, workspace_id, actor)
    get_task(db, workspace_id, project_id, task_id)
    link = db.get(TaskLabel, (task_id, label_id))
    if link is None:
        raise LabelNotFoundError
    db.delete(link)
    record_activity(
        db,
        workspace_id=workspace_id,
        project_id=project_id,
        task_id=task_id,
        actor_id=actor.id,
        event_type="task.label_removed",
        metadata={"label_id": str(label_id)},
    )
    db.commit()


def list_task_labels(
    db: Session,
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    actor: User,
) -> list[Label]:
    require_read_membership(db, workspace_id, actor)
    get_task(db, workspace_id, project_id, task_id)
    return list(
        db.scalars(
            select(Label)
            .join(TaskLabel, TaskLabel.label_id == Label.id)
            .where(TaskLabel.task_id == task_id)
            .order_by(Label.name)
        )
    )


def create_comment(
    db: Session,
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    actor: User,
    body: str,
) -> TaskComment:
    require_write_membership(db, workspace_id, actor)
    task = get_task(db, workspace_id, project_id, task_id)
    now = utc_now()
    comment = TaskComment(
        workspace_id=workspace_id,
        project_id=project_id,
        task_id=task_id,
        author_id=actor.id,
        body=body,
        created_at=now,
        updated_at=now,
    )
    db.add(comment)
    record_activity(
        db,
        workspace_id=workspace_id,
        project_id=project_id,
        task_id=task_id,
        actor_id=actor.id,
        event_type="task.comment_added",
    )
    notify_ids = {task.assignee_id, task.created_by_id} - {None, actor.id}
    for recipient_id in notify_ids:
        assert recipient_id is not None
        create_notification(
            db,
            user_id=recipient_id,
            workspace_id=workspace_id,
            notification_type="comment.created",
            title=f"New comment on {task.title}",
            body=body,
            project_id=project_id,
            task_id=task_id,
            actor_id=actor.id,
        )
    db.commit()
    db.refresh(comment)
    return comment


def list_comments(
    db: Session,
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    actor: User,
) -> list[TaskComment]:
    require_read_membership(db, workspace_id, actor)
    get_task(db, workspace_id, project_id, task_id)
    return list(
        db.scalars(
            select(TaskComment)
            .where(TaskComment.task_id == task_id, TaskComment.deleted_at.is_(None))
            .order_by(TaskComment.created_at)
        )
    )


def can_modify_comment(actor: User, membership: WorkspaceMember, comment: TaskComment) -> bool:
    return actor.id == comment.author_id or can(
        membership.role, WorkspaceAction.moderate_project_content
    )


def get_comment(
    db: Session,
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    comment_id: uuid.UUID,
) -> TaskComment:
    comment = db.scalar(
        select(TaskComment).where(
            TaskComment.id == comment_id,
            TaskComment.workspace_id == workspace_id,
            TaskComment.project_id == project_id,
            TaskComment.task_id == task_id,
            TaskComment.deleted_at.is_(None),
        )
    )
    if comment is None:
        raise CommentNotFoundError
    return comment


def update_comment(
    db: Session,
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    comment_id: uuid.UUID,
    actor: User,
    body: str,
) -> TaskComment:
    membership = require_write_membership(db, workspace_id, actor)
    comment = get_comment(db, workspace_id, project_id, task_id, comment_id)
    if not can_modify_comment(actor, membership, comment):
        raise ProjectForbiddenError
    comment.body = body
    comment.updated_at = utc_now()
    db.commit()
    db.refresh(comment)
    return comment


def delete_comment(
    db: Session,
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    comment_id: uuid.UUID,
    actor: User,
) -> None:
    membership = require_write_membership(db, workspace_id, actor)
    comment = get_comment(db, workspace_id, project_id, task_id, comment_id)
    if not can_modify_comment(actor, membership, comment):
        raise ProjectForbiddenError
    comment.deleted_at = utc_now()
    comment.updated_at = utc_now()
    db.commit()


def list_activity(
    db: Session,
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    actor: User,
    *,
    task_id: uuid.UUID | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[ActivityEvent]:
    require_read_membership(db, workspace_id, actor)
    get_project(db, workspace_id, project_id)
    query = select(ActivityEvent).where(
        ActivityEvent.workspace_id == workspace_id,
        ActivityEvent.project_id == project_id,
    )
    if task_id is not None:
        query = query.where(ActivityEvent.task_id == task_id)
    return list(db.scalars(query.order_by(ActivityEvent.created_at).limit(limit).offset(offset)))
