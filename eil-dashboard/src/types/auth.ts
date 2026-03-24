import type { Session, User } from "@supabase/supabase-js";
import type { WorkspaceProfile } from "@/types/workspace";

export type AppRole = "member" | "admin";

export interface UserProfileRecord {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  role: AppRole;
  workspace_profile: Partial<WorkspaceProfile> | null;
  created_at?: string;
  updated_at?: string;
}

export interface AuthContextValue {
  hydrated: boolean;
  session: Session | null;
  user: User | null;
  profile: UserProfileRecord | null;
  isAdmin: boolean;
  signInWithProvider: (
    provider: "google" | "facebook"
  ) => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUpWithPassword: (
    email: string,
    password: string,
    metadata?: { full_name?: string }
  ) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  saveUserProfile: (updates: {
    full_name?: string;
    avatar_url?: string;
  }) => Promise<void>;
  saveWorkspaceProfile: (workspaceProfile: WorkspaceProfile) => Promise<void>;
}
