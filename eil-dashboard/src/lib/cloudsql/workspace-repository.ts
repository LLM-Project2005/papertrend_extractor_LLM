import type { PoolClient } from "pg";
import type {
  ResearchFolderRow,
  WorkspaceOrganizationRow,
  WorkspaceProjectRow,
} from "@/types/database";
import { withCloudSqlOwnerTransaction } from "@/lib/cloudsql/client";
import { sanitizeFolderName } from "@/lib/research-folders";
import { sanitizeWorkspaceName } from "@/lib/workspace-organizations";

type OrganizationType = WorkspaceOrganizationRow["type"];

function rows<T>(result: { rows: T[] }): T[] {
  return result.rows;
}

export class CloudSqlWorkspaceRepository {
  async listOrganizations(ownerUserId: string): Promise<WorkspaceOrganizationRow[]> {
    return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      const result = await client.query<WorkspaceOrganizationRow>(
        `
          SELECT *
          FROM public.workspace_organizations
          WHERE owner_user_id = $1
          ORDER BY name ASC
        `,
        [ownerUserId]
      );
      return rows(result);
    });
  }

  async ensureOrganization(
    ownerUserId: string,
    name: string,
    type: OrganizationType
  ): Promise<WorkspaceOrganizationRow> {
    return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      const result = await client.query<WorkspaceOrganizationRow>(
        `
          INSERT INTO public.workspace_organizations
            (owner_user_id, name, type, updated_at)
          VALUES ($1, $2, $3, now())
          ON CONFLICT (owner_user_id, name)
          DO UPDATE SET type = EXCLUDED.type, updated_at = now()
          RETURNING *
        `,
        [ownerUserId, sanitizeWorkspaceName(name, "Untitled workspace"), type]
      );
      const organization = result.rows[0];
      if (!organization) {
        throw new Error("Failed to save workspace.");
      }
      return organization;
    });
  }

  async listProjects(
    ownerUserId: string,
    organizationId?: string | null
  ): Promise<WorkspaceProjectRow[]> {
    return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      const values: string[] = [ownerUserId];
      let organizationFilter = "";
      if (organizationId) {
        values.push(organizationId);
        organizationFilter = " AND organization_id = $2";
      }
      const result = await client.query<WorkspaceProjectRow>(
        `
          SELECT *
          FROM public.workspace_projects
          WHERE owner_user_id = $1${organizationFilter}
          ORDER BY name ASC
        `,
        values
      );
      return rows(result);
    });
  }

  async createProject(
    ownerUserId: string,
    organizationId: string,
    name: string,
    description?: string | null
  ): Promise<WorkspaceProjectRow> {
    return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      await assertOwnedOrganization(client, ownerUserId, organizationId);
      const result = await client.query<WorkspaceProjectRow>(
        `
          INSERT INTO public.workspace_projects
            (organization_id, owner_user_id, name, description, updated_at)
          VALUES ($1, $2, $3, $4, now())
          RETURNING *
        `,
        [
          organizationId,
          ownerUserId,
          sanitizeWorkspaceName(name, "Untitled project"),
          description?.trim() || null,
        ]
      );
      const project = result.rows[0];
      if (!project) {
        throw new Error("Failed to create project.");
      }
      return project;
    });
  }

  async updateProject(
    ownerUserId: string,
    projectId: string,
    patch: { name: string; description?: string | null }
  ): Promise<WorkspaceProjectRow | null> {
    return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      const result = await client.query<WorkspaceProjectRow>(
        `
          UPDATE public.workspace_projects
          SET name = $3,
              description = CASE
                WHEN $4::boolean THEN $5::text
                ELSE description
              END,
              updated_at = now()
          WHERE id = $1 AND owner_user_id = $2
          RETURNING *
        `,
        [
          projectId,
          ownerUserId,
          patch.name.trim(),
          patch.description !== undefined,
          patch.description ?? null,
        ]
      );
      return result.rows[0] ?? null;
    });
  }

  async listFolders(
    ownerUserId: string,
    projectId?: string | null
  ): Promise<ResearchFolderRow[]> {
    return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      const values: string[] = [ownerUserId];
      let projectFilter = "";
      if (projectId) {
        values.push(projectId);
        projectFilter = " AND project_id = $2";
      }
      const result = await client.query<ResearchFolderRow>(
        `
          SELECT *
          FROM public.research_folders
          WHERE owner_user_id = $1${projectFilter}
          ORDER BY name ASC
        `,
        values
      );
      return rows(result);
    });
  }

  async ensureFolder(
    ownerUserId: string,
    projectId: string,
    folderName: string
  ): Promise<ResearchFolderRow> {
    return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      const name = sanitizeFolderName(folderName);
      const project = await client.query<{ organization_id: string | null }>(
        `
          SELECT organization_id
          FROM public.workspace_projects
          WHERE id = $1 AND owner_user_id = $2
          LIMIT 1
        `,
        [projectId, ownerUserId]
      );
      const projectRow = project.rows[0];
      if (!projectRow) {
        throw new Error("Project not found.");
      }

      const existing = await client.query<ResearchFolderRow>(
        `
          SELECT *
          FROM public.research_folders
          WHERE owner_user_id = $1 AND project_id = $2 AND name = $3
          LIMIT 1
        `,
        [ownerUserId, projectId, name]
      );
      if (existing.rows[0]) {
        return existing.rows[0];
      }

      const legacy = await client.query<ResearchFolderRow>(
        `
          SELECT *
          FROM public.research_folders
          WHERE owner_user_id = $1 AND project_id IS NULL AND name = $2
          LIMIT 1
        `,
        [ownerUserId, name]
      );
      if (legacy.rows[0]) {
        const migrated = await client.query<ResearchFolderRow>(
          `
            UPDATE public.research_folders
            SET organization_id = $2, project_id = $3, updated_at = now()
            WHERE id = $1 AND owner_user_id = $4
            RETURNING *
          `,
          [legacy.rows[0].id, projectRow.organization_id, projectId, ownerUserId]
        );
        return migrated.rows[0] ?? legacy.rows[0];
      }

      try {
        const created = await client.query<ResearchFolderRow>(
          `
            INSERT INTO public.research_folders
              (owner_user_id, organization_id, project_id, name, updated_at)
            VALUES ($1, $2, $3, $4, now())
            RETURNING *
          `,
          [ownerUserId, projectRow.organization_id, projectId, name]
        );
        if (!created.rows[0]) {
          throw new Error("Failed to create workspace folder.");
        }
        return created.rows[0];
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
        const duplicate = await client.query<ResearchFolderRow>(
          `
            SELECT *
            FROM public.research_folders
            WHERE owner_user_id = $1 AND project_id = $2 AND name = $3
            LIMIT 1
          `,
          [ownerUserId, projectId, name]
        );
        if (!duplicate.rows[0]) {
          throw new Error("A folder with this name already exists.");
        }
        return duplicate.rows[0];
      }
    });
  }

  async updateFolder(
    ownerUserId: string,
    folderId: string,
    name: string
  ): Promise<ResearchFolderRow | null> {
    return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      const result = await client.query<ResearchFolderRow>(
        `
          UPDATE public.research_folders
          SET name = $3, updated_at = now()
          WHERE id = $1 AND owner_user_id = $2
          RETURNING *
        `,
        [folderId, ownerUserId, sanitizeFolderName(name)]
      );
      return result.rows[0] ?? null;
    });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "23505"
  );
}

async function assertOwnedOrganization(
  client: PoolClient,
  ownerUserId: string,
  organizationId: string
): Promise<void> {
  const result = await client.query<{ id: string }>(
    `
      SELECT id
      FROM public.workspace_organizations
      WHERE id = $1 AND owner_user_id = $2
      LIMIT 1
    `,
    [organizationId, ownerUserId]
  );
  if (!result.rows[0]) {
    throw new Error("Workspace not found.");
  }
}
