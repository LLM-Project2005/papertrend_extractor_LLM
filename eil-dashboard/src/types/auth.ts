import type { User } from "@supabase/supabase-js";
import type { WorkspaceProfile } from "@/types/workspace";

export type AuthProviderName = "supabase" | "firebase";

export interface AuthSession {
  access_token: string;
  refresh_token: string | null;
  expires_at?: number | null;
  user: User;
  provider: AuthProviderName;
}

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
  session: AuthSession | null;
  user: User | null;
  profile: UserProfileRecord | null;
  isAdmin: boolean;
  authError: string | null;
  signInWithProvider: (
    provider: "google" | "facebook"
  ) => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUpWithPassword: (
    email: string,
    password: string,
    metadata?: { full_name?: string }
  ) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  saveUserProfile: (updates: {
    full_name?: string;
    avatar_url?: string;
  }) => Promise<void>;
  saveWorkspaceProfile: (workspaceProfile: WorkspaceProfile) => Promise<void>;
}
