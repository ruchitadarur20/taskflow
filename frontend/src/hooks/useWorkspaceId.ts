import { useParams } from "react-router-dom";

export function useWorkspaceId(): string | undefined {
  return useParams<{ workspaceId: string }>().workspaceId;
}

export function useProjectId(): string | undefined {
  return useParams<{ projectId: string }>().projectId;
}
