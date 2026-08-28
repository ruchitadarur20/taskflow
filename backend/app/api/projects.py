from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user
from app.db.session import get_db
from app.domains.auth.models import User
from app.domains.projects import service
from app.domains.projects.models import (
    ActivityEvent,
    Label,
    Project,
    Task,
    TaskComment,
    TaskDependency,
    TaskStatus,
)
from app.domains.projects.schemas import (
    ActivityEventRead,
    CommentCreateRequest,
    CommentRead,
    CommentUpdateRequest,
    DependencyCreateRequest,
    LabelCreateRequest,
    LabelRead,
    ProjectCreateRequest,
    ProjectRead,
    ProjectUpdateRequest,
    TaskCreateRequest,
    TaskDependencyRead,
    TaskLabelRequest,
    TaskRead,
    TaskUpdateRequest,
)
from app.domains.workspaces import service as workspace_service

router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["projects"])


def project_response(project: Project) -> ProjectRead:
    return ProjectRead.model_validate(project)


def task_response(task: Task) -> TaskRead:
    return TaskRead.model_validate(task)


def label_response(label: Label) -> LabelRead:
    return LabelRead.model_validate(label)


def dependency_response(dependency: TaskDependency) -> TaskDependencyRead:
    return TaskDependencyRead.model_validate(dependency)


def comment_response(comment: TaskComment) -> CommentRead:
    return CommentRead.model_validate(comment)


def activity_response(event: ActivityEvent) -> ActivityEventRead:
    return ActivityEventRead.model_validate(event)


def translate_project_error(
    error: service.ProjectError | workspace_service.WorkspaceError,
) -> HTTPException:
    if isinstance(error, workspace_service.WorkspaceNotFoundError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resource not found")
    if isinstance(error, workspace_service.WorkspaceArchivedError):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Workspace is archived")
    if isinstance(error, service.ProjectNotFoundError | service.TaskNotFoundError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resource not found")
    if isinstance(error, service.LabelNotFoundError | service.CommentNotFoundError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resource not found")
    if isinstance(error, service.ProjectArchivedError):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Project is archived")
    if isinstance(error, service.DuplicateProjectError):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Project already exists")
    if isinstance(error, service.InvalidAssignmentError):
        return HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid assignee"
        )
    if isinstance(error, service.InvalidParentTaskError):
        return HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid parent task"
        )
    if isinstance(error, service.InvalidDependencyError):
        return HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid dependency"
        )
    if isinstance(error, service.DuplicateDependencyError):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Dependency already exists"
        )
    if isinstance(error, service.DuplicateLabelError):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Label already exists")
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")


@router.post("/projects", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
def create_project(
    workspace_id: uuid.UUID,
    payload: ProjectCreateRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ProjectRead:
    try:
        project = service.create_project(
            db,
            workspace_id,
            current_user,
            name=payload.name,
            description=payload.description,
        )
    except (service.ProjectError, workspace_service.WorkspaceError) as error:
        raise translate_project_error(error) from None
    return project_response(project)


@router.get("/projects", response_model=list[ProjectRead])
def list_projects(
    workspace_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[ProjectRead]:
    try:
        return [
            project_response(project)
            for project in service.list_projects(db, workspace_id, current_user)
        ]
    except (service.ProjectError, workspace_service.WorkspaceError) as error:
        raise translate_project_error(error) from None


@router.get("/projects/{project_id}", response_model=ProjectRead)
def get_project(
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ProjectRead:
    try:
        return project_response(
            service.get_project_for_user(db, workspace_id, project_id, current_user)
        )
    except (service.ProjectError, workspace_service.WorkspaceError) as error:
        raise translate_project_error(error) from None


@router.patch("/projects/{project_id}", response_model=ProjectRead)
def update_project(
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    payload: ProjectUpdateRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ProjectRead:
    try:
        project = service.update_project(
            db,
            workspace_id,
            project_id,
            current_user,
            name=payload.name,
            description=payload.description,
        )
    except (service.ProjectError, workspace_service.WorkspaceError) as error:
        raise translate_project_error(error) from None
    return project_response(project)


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def archive_project(
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> None:
    try:
        service.archive_project(db, workspace_id, project_id, current_user)
    except (service.ProjectError, workspace_service.WorkspaceError) as error:
        raise translate_project_error(error) from None


@router.post(
    "/projects/{project_id}/labels", response_model=LabelRead, status_code=status.HTTP_201_CREATED
)
def create_label(
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    payload: LabelCreateRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> LabelRead:
    try:
        return label_response(
            service.create_label(
                db,
                workspace_id,
                project_id,
                current_user,
                name=payload.name,
                color=payload.color,
            )
        )
    except (service.ProjectError, workspace_service.WorkspaceError) as error:
        raise translate_project_error(error) from None


@router.get("/projects/{project_id}/labels", response_model=list[LabelRead])
def list_labels(
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[LabelRead]:
    try:
        return [
            label_response(label)
            for label in service.list_labels(db, workspace_id, project_id, current_user)
        ]
    except (service.ProjectError, workspace_service.WorkspaceError) as error:
        raise translate_project_error(error) from None


@router.post(
    "/projects/{project_id}/tasks", response_model=TaskRead, status_code=status.HTTP_201_CREATED
)
def create_task(
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    payload: TaskCreateRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> TaskRead:
    try:
        task = service.create_task(
            db,
            workspace_id,
            project_id,
            current_user,
            title=payload.title,
            description=payload.description,
            status=payload.status,
            priority=payload.priority,
            assignee_id=payload.assignee_id,
            due_at=payload.due_at,
            parent_task_id=payload.parent_task_id,
        )
    except (service.ProjectError, workspace_service.WorkspaceError) as error:
        raise translate_project_error(error) from None
    return task_response(task)


@router.get("/projects/{project_id}/tasks", response_model=list[TaskRead])
def list_tasks(
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    task_status: Annotated[TaskStatus | None, Query(alias="status")] = None,
    assignee_id: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[TaskRead]:
    try:
        tasks = service.list_tasks(
            db,
            workspace_id,
            project_id,
            current_user,
            status=task_status,
            assignee_id=assignee_id,
            limit=limit,
            offset=offset,
        )
    except (service.ProjectError, workspace_service.WorkspaceError) as error:
        raise translate_project_error(error) from None
    return [task_response(task) for task in tasks]


@router.get("/projects/{project_id}/tasks/{task_id}", response_model=TaskRead)
def get_task(
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> TaskRead:
    try:
        service.require_read_membership(db, workspace_id, current_user)
        return task_response(service.get_task(db, workspace_id, project_id, task_id))
    except (service.ProjectError, workspace_service.WorkspaceError) as error:
        raise translate_project_error(error) from None


@router.patch("/projects/{project_id}/tasks/{task_id}", response_model=TaskRead)
def update_task(
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    payload: TaskUpdateRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> TaskRead:
    try:
        return task_response(
            service.update_task(
                db,
                workspace_id,
                project_id,
                task_id,
                current_user,
                **payload.model_dump(exclude_unset=True),
            )
        )
    except (service.ProjectError, workspace_service.WorkspaceError) as error:
        raise translate_project_error(error) from None


@router.delete("/projects/{project_id}/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def archive_task(
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> None:
    try:
        service.archive_task(db, workspace_id, project_id, task_id, current_user)
    except (service.ProjectError, workspace_service.WorkspaceError) as error:
        raise translate_project_error(error) from None


@router.post(
    "/projects/{project_id}/tasks/{task_id}/dependencies",
    response_model=TaskDependencyRead,
    status_code=status.HTTP_201_CREATED,
)
def add_dependency(
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    payload: DependencyCreateRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> TaskDependencyRead:
    try:
        dependency = service.add_dependency(
            db,
            workspace_id,
            project_id,
            task_id,
            current_user,
            payload.blocking_task_id,
        )
    except (service.ProjectError, workspace_service.WorkspaceError) as error:
        raise translate_project_error(error) from None
    return dependency_response(dependency)


@router.get(
    "/projects/{project_id}/tasks/{task_id}/dependencies", response_model=list[TaskDependencyRead]
)
def list_dependencies(
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[TaskDependencyRead]:
    try:
        dependencies = service.list_dependencies(
            db, workspace_id, project_id, task_id, current_user
        )
    except (service.ProjectError, workspace_service.WorkspaceError) as error:
        raise translate_project_error(error) from None
    return [dependency_response(dependency) for dependency in dependencies]


@router.post("/projects/{project_id}/tasks/{task_id}/labels", response_model=list[LabelRead])
def add_task_label(
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    payload: TaskLabelRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[LabelRead]:
    try:
        labels = service.add_label_to_task(
            db, workspace_id, project_id, task_id, current_user, payload.label_id
        )
    except (service.ProjectError, workspace_service.WorkspaceError) as error:
        raise translate_project_error(error) from None
    return [label_response(label) for label in labels]


@router.get("/projects/{project_id}/tasks/{task_id}/labels", response_model=list[LabelRead])
def list_task_labels(
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[LabelRead]:
    try:
        labels = service.list_task_labels(db, workspace_id, project_id, task_id, current_user)
    except (service.ProjectError, workspace_service.WorkspaceError) as error:
        raise translate_project_error(error) from None
    return [label_response(label) for label in labels]


@router.delete(
    "/projects/{project_id}/tasks/{task_id}/labels/{label_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def remove_task_label(
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    label_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> None:
    try:
        service.remove_label_from_task(
            db, workspace_id, project_id, task_id, current_user, label_id
        )
    except (service.ProjectError, workspace_service.WorkspaceError) as error:
        raise translate_project_error(error) from None


@router.post(
    "/projects/{project_id}/tasks/{task_id}/comments",
    response_model=CommentRead,
    status_code=status.HTTP_201_CREATED,
)
def create_comment(
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    payload: CommentCreateRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> CommentRead:
    try:
        comment = service.create_comment(
            db, workspace_id, project_id, task_id, current_user, payload.body
        )
    except (service.ProjectError, workspace_service.WorkspaceError) as error:
        raise translate_project_error(error) from None
    return comment_response(comment)


@router.get("/projects/{project_id}/tasks/{task_id}/comments", response_model=list[CommentRead])
def list_comments(
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[CommentRead]:
    try:
        comments = service.list_comments(db, workspace_id, project_id, task_id, current_user)
    except (service.ProjectError, workspace_service.WorkspaceError) as error:
        raise translate_project_error(error) from None
    return [comment_response(comment) for comment in comments]


@router.patch(
    "/projects/{project_id}/tasks/{task_id}/comments/{comment_id}", response_model=CommentRead
)
def update_comment(
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    comment_id: uuid.UUID,
    payload: CommentUpdateRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> CommentRead:
    try:
        comment = service.update_comment(
            db, workspace_id, project_id, task_id, comment_id, current_user, payload.body
        )
    except (service.ProjectError, workspace_service.WorkspaceError) as error:
        raise translate_project_error(error) from None
    return comment_response(comment)


@router.delete(
    "/projects/{project_id}/tasks/{task_id}/comments/{comment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_comment(
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    comment_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> None:
    try:
        service.delete_comment(db, workspace_id, project_id, task_id, comment_id, current_user)
    except (service.ProjectError, workspace_service.WorkspaceError) as error:
        raise translate_project_error(error) from None


@router.get("/projects/{project_id}/activity", response_model=list[ActivityEventRead])
def list_activity(
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    task_id: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[ActivityEventRead]:
    try:
        events = service.list_activity(
            db,
            workspace_id,
            project_id,
            current_user,
            task_id=task_id,
            limit=limit,
            offset=offset,
        )
    except (service.ProjectError, workspace_service.WorkspaceError) as error:
        raise translate_project_error(error) from None
    return [activity_response(event) for event in events]
