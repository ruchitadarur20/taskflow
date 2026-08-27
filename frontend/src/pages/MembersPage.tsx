import { FormEvent, useState } from "react";
import { UserPlus, Users } from "lucide-react";

import { useWorkspaceId } from "../hooks/useWorkspaceId";
import {
  useAddWorkspaceMember,
  useChangeMemberRole,
  useRemoveMember,
  useWorkspace,
  useWorkspaceMembers,
} from "../hooks/useWorkspaces";
import { useToast } from "../context/ToastContext";
import { Avatar } from "../components/ui/Avatar";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { EmptyState } from "../components/ui/EmptyState";
import { QueryBoundary } from "../components/data/QueryBoundary";
import { PermissionDeniedPage } from "./PermissionDeniedPage";
import { ApiError } from "../api/client";
import type { WorkspaceRole } from "../api/workspaces";

const ROLES: WorkspaceRole[] = ["owner", "admin", "member", "viewer"];

export function MembersPage() {
  const workspaceId = useWorkspaceId() as string;
  const workspaceQuery = useWorkspace(workspaceId);
  const membersQuery = useWorkspaceMembers(workspaceId);
  const addMember = useAddWorkspaceMember(workspaceId);
  const changeRole = useChangeMemberRole(workspaceId);
  const removeMember = useRemoveMember(workspaceId);
  const { toast } = useToast();

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("member");

  const canManage =
    workspaceQuery.data?.current_user_role === "owner" || workspaceQuery.data?.current_user_role === "admin";

  if (workspaceQuery.isError) {
    const error = workspaceQuery.error;
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
      return (
        <PermissionDeniedPage message="This workspace doesn't exist, or you don't have access to it." />
      );
    }
  }

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    try {
      await addMember.mutateAsync({ email: email.trim(), role });
      toast({ title: "Member added", variant: "success" });
      setEmail("");
    } catch (error) {
      toast({
        title: "Couldn't add member",
        description: error instanceof Error ? error.message : undefined,
        variant: "error",
      });
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="text-xl font-semibold text-foreground">Members</h1>
      <p className="mt-1 text-sm text-muted-foreground">People with access to this workspace.</p>

      {canManage ? (
        <form onSubmit={handleAdd} className="mt-5 flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            <Input
              type="email"
              placeholder="email@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <Select
            value={role}
            onChange={(event) => setRole(event.target.value as WorkspaceRole)}
            className="w-32"
          >
            {ROLES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
          <Button type="submit" isLoading={addMember.isPending}>
            <UserPlus className="h-4 w-4" /> Invite
          </Button>
        </form>
      ) : null}

      <div className="mt-6">
        <QueryBoundary query={membersQuery}>
          {(members) =>
            members.length === 0 ? (
              <EmptyState icon={Users} title="No members yet" />
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-card">
                {members.map((member) => (
                  <li key={member.id} className="flex items-center gap-3 px-4 py-3">
                    <Avatar name={member.user.display_name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {member.user.display_name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{member.user.email}</p>
                    </div>
                    {canManage ? (
                      <Select
                        value={member.role}
                        onChange={(event) =>
                          changeRole.mutate({ userId: member.user_id, role: event.target.value as WorkspaceRole })
                        }
                        className="w-32"
                        aria-label={`Role for ${member.user.display_name}`}
                      >
                        {ROLES.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <span className="text-sm capitalize text-muted-foreground">{member.role}</span>
                    )}
                    {canManage ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeMember.mutate(member.user_id)}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )
          }
        </QueryBoundary>
      </div>
    </div>
  );
}
