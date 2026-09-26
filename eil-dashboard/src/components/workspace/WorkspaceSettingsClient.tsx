"use client";

/*
 * Settings, in two groups a reader can tell apart at a glance:
 *
 *  - Account: things about you that follow you into every repository - your
 *    profile, how you sign in, and how the app looks.
 *  - Repository: things about the repository that is open - its name and
 *    description, and how its papers are classified.
 *
 * Every control here writes to something real. The earlier page also carried
 * a goal, an intake source and output defaults that nothing read, a "Reset
 * repository" that only cleared this browser, and a placeholder workspace name;
 * those are gone rather than restyled.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useTheme, type ThemePreference } from "@/components/theme/ThemeProvider";
import AnalysisProfileEditor from "@/components/workspace/AnalysisProfileEditor";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import {
  ArrowRightIcon,
  BookOpenIcon,
  CheckCircleIcon,
  CheckIcon,
  CopyIcon,
  EqualizerIcon,
  FolderIcon,
  LogoutIcon,
  MonitorIcon,
  MoonIcon,
  PaletteIcon,
  ShieldCheckIcon,
  SunIcon,
  UserCircleIcon,
} from "@/components/ui/Icons";
import {
  buttonClass,
  chipClass,
  fieldClass,
  hintClass,
  labelClass,
  panelClass,
} from "@/components/ui/controls";
import { createGeneralAnalysisProfile, sanitizeProjectAnalysisProfile } from "@/lib/project-analysis-profile";
import type { ProjectAnalysisProfile } from "@/types/workspace";

type SectionId = "profile" | "security" | "appearance" | "repository" | "analysis";

type SectionDef = {
  id: SectionId;
  group: "Account" | "Repository";
  label: string;
  description: string;
  icon: (props: { className?: string }) => JSX.Element;
};

const PROJECT_ANALYSIS_PROFILES_ENABLED =
  process.env.NEXT_PUBLIC_PROJECT_ANALYSIS_PROFILES_ENABLED === "true";

const SECTIONS: SectionDef[] = [
  {
    id: "profile",
    group: "Account",
    label: "Profile",
    description: "Your name and picture, as the workspace shows them.",
    icon: UserCircleIcon,
  },
  {
    id: "security",
    group: "Account",
    label: "Sign-in & security",
    description: "How you sign in, your password, and this device's session.",
    icon: ShieldCheckIcon,
  },
  {
    id: "appearance",
    group: "Account",
    label: "Appearance",
    description: "Light, dark, or matching your device.",
    icon: PaletteIcon,
  },
  {
    id: "repository",
    group: "Repository",
    label: "General",
    description: "The repository's name, description and ID.",
    icon: FolderIcon,
  },
  {
    id: "analysis",
    group: "Repository",
    label: "Analysis & classification",
    description: "How the papers in this repository are categorized.",
    icon: EqualizerIcon,
  },
];

const VISIBLE_SECTIONS = PROJECT_ANALYSIS_PROFILES_ENABLED
  ? SECTIONS
  : SECTIONS.filter((section) => section.id !== "analysis");

/** Old ?section= values still land on the page that took their place. */
const LEGACY_SECTIONS: Record<string, SectionId> = {
  general: "repository",
  project: "repository",
  access: "security",
  account: "profile",
};

function resolveSection(requested: string | null): SectionId {
  if (!requested) return "profile";
  const mapped = LEGACY_SECTIONS[requested] ?? requested;
  return VISIBLE_SECTIONS.some((section) => section.id === mapped) ? (mapped as SectionId) : "profile";
}

const SIGN_IN_METHOD_LABELS: Record<string, string> = {
  password: "Email and password",
  email: "Email and password",
  "google.com": "Google",
  google: "Google",
  "facebook.com": "Facebook",
  facebook: "Facebook",
};

function formatDate(value?: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function initialsOf(name: string, email: string) {
  const source = name.trim() || email.split("@")[0] || "";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : source.slice(0, 2);
  return letters.toUpperCase() || "?";
}

/* ------------------------------------------------------------ layout parts */

function Section({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className={`${panelClass} overflow-hidden`}>
      <div className="px-5 pt-5 sm:px-6 sm:pt-6">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {description ? <p className="mt-1 text-sm leading-6 text-body">{description}</p> : null}
      </div>
      <div className="px-5 pb-5 sm:px-6 sm:pb-6">{children}</div>
      {footer ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline bg-canvas/60 px-5 py-3 sm:px-6">
          {footer}
        </div>
      ) : null}
    </section>
  );
}

/** One setting: its name and help on the left, the control on the right. */
function Row({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-3 border-t border-hairline py-5 first:border-t-0 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)] md:gap-8">
      <div className="min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} className={labelClass}>
            {label}
          </label>
        ) : (
          <p className={labelClass}>{label}</p>
        )}
        {hint ? <p className={hintClass}>{hint}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** "Saved" that appears beside the button and fades on its own. */
function SavedNote({ show, text = "Saved" }: { show: boolean; text?: string }) {
  return (
    <span
      role="status"
      className={`inline-flex items-center gap-1.5 text-[13px] text-body transition-opacity duration-300 ${
        show ? "opacity-100" : "opacity-0"
      }`}
    >
      {show ? (
        <>
          <CheckCircleIcon weight="fill" className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          {text}
        </>
      ) : null}
    </span>
  );
}

function useFlash(duration = 2600) {
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(false), duration);
    return () => window.clearTimeout(timer);
  }, [duration, flash]);
  return [flash, () => setFlash(true)] as const;
}

function Avatar({ name, email, url, size = 56 }: { name: string; email: string; url: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);
  const showImage = Boolean(url) && !broken && /^https:\/\//i.test(url);
  return (
    <span
      className="flex flex-none items-center justify-center overflow-hidden rounded-full bg-subtle text-body ring-1 ring-hairline"
      style={{ width: size, height: size }}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" onError={() => setBroken(true)} />
      ) : (
        <span className="text-base font-medium">{initialsOf(name, email)}</span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------- the sections */

function ProfileSection() {
  const { user, profile, isAdmin, saveUserProfile } = useAuth();
  const savedName = profile?.full_name ?? "";
  const savedAvatar = profile?.avatar_url ?? "";
  const email = profile?.email ?? user?.email ?? "";
  const [name, setName] = useState(savedName);
  const [avatar, setAvatar] = useState(savedAvatar);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, flashSaved] = useFlash();

  useEffect(() => setName(savedName), [savedName]);
  useEffect(() => setAvatar(savedAvatar), [savedAvatar]);

  const dirty = name.trim() !== savedName.trim() || avatar.trim() !== savedAvatar.trim();
  const avatarInvalid = Boolean(avatar.trim()) && !/^https:\/\/\S+$/i.test(avatar.trim());

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await saveUserProfile({ full_name: name.trim(), avatar_url: avatar.trim() });
      flashSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Your profile could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section
      title="Profile"
      description="Shown in the workspace header and on anything you share from a repository."
      footer={
        <>
          <div className="min-h-5 text-[13px]">
            {error ? (
              <span className="text-red-700 dark:text-red-300" role="alert">
                {error}
              </span>
            ) : dirty ? (
              <span className="text-mute">Unsaved changes</span>
            ) : (
              <SavedNote show={saved} />
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!dirty || saving}
              onClick={() => {
                setName(savedName);
                setAvatar(savedAvatar);
                setError(null);
              }}
              className={buttonClass("ghost", "sm")}
            >
              Discard
            </button>
            <button
              type="button"
              disabled={!dirty || saving || avatarInvalid}
              onClick={() => void save()}
              className={buttonClass("primary", "sm")}
            >
              {saving ? "Saving..." : "Save profile"}
            </button>
          </div>
        </>
      }
    >
      <div className="flex items-center gap-4 pb-5 pt-4">
        <Avatar name={name} email={email} url={avatar.trim()} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">{name.trim() || email || "Your account"}</p>
          <p className="truncate text-[13px] text-mute">{email}</p>
          <span className={chipClass("neutral", "mt-1.5")}>{isAdmin ? "Admin" : "Member"}</span>
        </div>
      </div>
      <Row label="Display name" htmlFor="settings-name" hint="Your full name, or how colleagues know you.">
        <input
          id="settings-name"
          value={name}
          maxLength={120}
          autoComplete="name"
          onChange={(event) => setName(event.target.value)}
          placeholder="Your name"
          className={fieldClass}
        />
      </Row>
      <Row
        label="Picture"
        htmlFor="settings-avatar"
        hint="A link to a square image that starts with https://. Leave it empty to show your initials."
      >
        <input
          id="settings-avatar"
          value={avatar}
          maxLength={2000}
          inputMode="url"
          onChange={(event) => setAvatar(event.target.value)}
          placeholder="https://"
          aria-invalid={avatarInvalid}
          aria-describedby={avatarInvalid ? "settings-avatar-error" : undefined}
          className={`${fieldClass} aria-[invalid=true]:border-red-500`}
        />
        {avatarInvalid ? (
          <p id="settings-avatar-error" className="mt-1.5 text-[13px] text-red-700 dark:text-red-300">
            Use a full link that starts with https://.
          </p>
        ) : null}
      </Row>
      <Row label="Email" hint="Your sign-in address. It cannot be changed here.">
        <p className="flex min-h-9 items-center truncate text-sm text-ink">{email || "Not available"}</p>
      </Row>
    </Section>
  );
}

function SecuritySection() {
  const router = useRouter();
  const { user, profile, isAdmin, resetPassword, signOut } = useAuth();
  const [resetState, setResetState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [resetError, setResetError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const email = profile?.email ?? user?.email ?? "";
  const metadata = (user?.app_metadata ?? {}) as { provider?: string; sign_in_methods?: unknown };
  const methods = Array.isArray(metadata.sign_in_methods)
    ? metadata.sign_in_methods.filter((item): item is string => typeof item === "string")
    : metadata.provider && metadata.provider !== "firebase"
      ? [metadata.provider]
      : [];
  const labels = [...new Set(methods.map((method) => SIGN_IN_METHOD_LABELS[method] ?? "Papertrend account"))];
  // Without a method list the account may still have a password, so the reset
  // stays available rather than being hidden on a guess.
  const hasPassword = methods.length === 0 || methods.some((method) => method === "password" || method === "email");
  const confirmed = Boolean((user as { email_confirmed_at?: string | null; confirmed_at?: string | null } | null)?.confirmed_at ?? (user as { email_confirmed_at?: string | null } | null)?.email_confirmed_at);

  async function sendReset() {
    if (!email) return;
    setResetState("sending");
    setResetError(null);
    try {
      await resetPassword(email);
      setResetState("sent");
    } catch (error) {
      setResetState("error");
      setResetError(error instanceof Error ? error.message : "The reset email could not be sent.");
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      router.push("/login");
    } catch {
      setSigningOut(false);
    }
  }

  return (
    <Section title="Sign-in & security" description="How you get into Papertrend, and the session on this device.">
      <Row label="Signed in as">
        <div className="flex min-h-9 flex-wrap items-center gap-2">
          <span className="truncate text-sm text-ink">{email || "Unknown"}</span>
          {confirmed ? <span className={chipClass("success")}>Verified</span> : null}
        </div>
      </Row>
      <Row label="Sign-in method" hint="Set when the account was created.">
        <p className="flex min-h-9 items-center text-sm text-ink">{labels.length ? labels.join(", ") : "Papertrend account"}</p>
      </Row>
      <Row
        label="Password"
        hint={
          hasPassword
            ? "We email you a link to choose a new password. The current one keeps working until you do."
            : "You sign in with a provider, so there is no Papertrend password to change."
        }
      >
        {hasPassword ? (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!email || resetState === "sending" || resetState === "sent"}
              onClick={() => void sendReset()}
              className={buttonClass("secondary", "sm")}
            >
              {resetState === "sending" ? "Sending..." : resetState === "sent" ? "Link sent" : "Email me a reset link"}
            </button>
            {resetState === "sent" ? (
              <span className="text-[13px] text-body" role="status">
                Check {email}.
              </span>
            ) : resetState === "error" ? (
              <span className="text-[13px] text-red-700 dark:text-red-300" role="alert">
                {resetError}
              </span>
            ) : null}
          </div>
        ) : (
          <p className="flex min-h-9 items-center text-sm text-mute">Not applicable</p>
        )}
      </Row>
      <Row label="Account">
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[13px] text-mute">Member since</dt>
            <dd className="mt-0.5 text-ink">{formatDate(user?.created_at) || "Not available"}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-mute">Last sign-in</dt>
            <dd className="mt-0.5 text-ink">{formatDate(user?.last_sign_in_at) || "Not available"}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-mute">Role</dt>
            <dd className="mt-0.5 text-ink">{isAdmin ? "Admin" : "Member"}</dd>
          </div>
        </dl>
      </Row>
      <Row label="This device" hint="Signs you out here. Your repositories and papers are not affected.">
        <button
          type="button"
          disabled={signingOut}
          onClick={() => void handleSignOut()}
          className={buttonClass("secondary", "sm")}
        >
          <LogoutIcon className="h-4 w-4" />
          {signingOut ? "Signing out..." : "Sign out"}
        </button>
      </Row>
    </Section>
  );
}

const THEME_CHOICES: Array<{
  id: ThemePreference;
  label: string;
  hint: string;
  icon: (props: { className?: string }) => JSX.Element;
}> = [
  { id: "light", label: "Light", hint: "Dark text on white", icon: SunIcon },
  { id: "dark", label: "Dark", hint: "Light text on black", icon: MoonIcon },
  { id: "system", label: "System", hint: "Matches your device", icon: MonitorIcon },
];

/** A small painted swatch of each theme, not a screenshot. */
function ThemeSwatch({ id }: { id: ThemePreference }) {
  const pane = (dark: boolean) => (
    <span className={`flex h-full flex-1 flex-col gap-1.5 p-2.5 ${dark ? "bg-[#000000]" : "bg-[#fafafa]"}`}>
      <span className={`h-1.5 w-8 rounded-full ${dark ? "bg-[#ededed]" : "bg-[#171717]"}`} />
      <span className={`flex-1 rounded-md border ${dark ? "border-[#1f1f1f] bg-[#0a0a0a]" : "border-[#e8e8e8] bg-white"}`}>
        <span className={`m-1.5 block h-1 w-3/4 rounded-full ${dark ? "bg-[#2e2e2e]" : "bg-[#e8e8e8]"}`} />
        <span className={`mx-1.5 block h-1 w-1/2 rounded-full ${dark ? "bg-[#2e2e2e]" : "bg-[#e8e8e8]"}`} />
      </span>
    </span>
  );
  return (
    <span aria-hidden="true" className="flex h-20 overflow-hidden rounded-lg border border-hairline">
      {id === "system" ? (
        <>
          {pane(false)}
          {pane(true)}
        </>
      ) : (
        pane(id === "dark")
      )}
    </span>
  );
}

function AppearanceSection() {
  const { preference, hydrated, setPreference } = useTheme();
  return (
    <Section title="Appearance" description="Applies on this device straight away, and every time you come back.">
      <div role="radiogroup" aria-label="Theme" className="grid gap-3 pt-4 sm:grid-cols-3">
        {THEME_CHOICES.map((choice) => {
          const selected = hydrated && preference === choice.id;
          const Icon = choice.icon;
          return (
            <button
              key={choice.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setPreference(choice.id)}
              className={`rounded-xl border bg-surface p-2 text-left transition-[border-color,box-shadow,background-color] duration-150 ${
                selected
                  ? "border-ink shadow-[0_0_0_1px_rgb(var(--ink))]"
                  : "border-hairline hover:border-hairline-strong hover:bg-subtle"
              }`}
            >
              <ThemeSwatch id={choice.id} />
              <span className="flex items-center justify-between gap-2 px-1.5 pb-1 pt-3">
                <span className="flex items-center gap-2 text-sm font-medium text-ink">
                  <Icon className="h-4 w-4 text-body" />
                  {choice.label}
                </span>
                <span
                  aria-hidden="true"
                  className={`flex h-4 w-4 items-center justify-center rounded-full transition-colors duration-150 ${
                    selected ? "bg-ink text-canvas" : "border border-hairline-strong"
                  }`}
                >
                  {selected ? <CheckIcon weight="bold" className="h-2.5 w-2.5" /> : null}
                </span>
              </span>
              <span className="block px-1.5 pb-1 text-[13px] text-mute">{choice.hint}</span>
            </button>
          );
        })}
      </div>
      <p className={`${hintClass} mt-4`}>
        The theme is stored in this browser. Reduced motion follows your device&apos;s accessibility setting.
      </p>
    </Section>
  );
}

function RepositorySection() {
  const { currentProject, renameProject } = useWorkspaceProfile();
  const savedName = currentProject?.name ?? "";
  const savedDescription = currentProject?.description ?? "";
  const [name, setName] = useState(savedName);
  const [description, setDescription] = useState(savedDescription);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, flashSaved] = useFlash();
  const [copied, flashCopied] = useFlash(1600);

  useEffect(() => setName(savedName), [savedName]);
  useEffect(() => setDescription(savedDescription), [savedDescription]);

  const dirty = name.trim() !== savedName.trim() || description.trim() !== savedDescription.trim();
  const nameMissing = !name.trim();

  async function save() {
    if (!currentProject || nameMissing) return;
    setSaving(true);
    setError(null);
    try {
      await renameProject(currentProject.id, name.trim(), description.trim() || null);
      flashSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The repository could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function copyId() {
    if (!currentProject) return;
    try {
      await navigator.clipboard.writeText(currentProject.id);
      flashCopied();
    } catch {
      // Clipboard access can be refused; the ID stays selectable on screen.
    }
  }

  if (!currentProject) {
    return (
      <Section title="General" description="Open a repository to change its settings.">
        <Link href="/workspaces" className={buttonClass("secondary", "sm", "mt-4")}>
          Choose a repository
          <ArrowRightIcon className="h-4 w-4" />
        </Link>
      </Section>
    );
  }

  return (
    <Section
      title="General"
      description="How this repository is named and described wherever it appears."
      footer={
        <>
          <div className="min-h-5 text-[13px]">
            {error ? (
              <span className="text-red-700 dark:text-red-300" role="alert">
                {error}
              </span>
            ) : dirty ? (
              <span className="text-mute">Unsaved changes</span>
            ) : (
              <SavedNote show={saved} />
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!dirty || saving}
              onClick={() => {
                setName(savedName);
                setDescription(savedDescription);
                setError(null);
              }}
              className={buttonClass("ghost", "sm")}
            >
              Discard
            </button>
            <button
              type="button"
              disabled={!dirty || saving || nameMissing}
              onClick={() => void save()}
              className={buttonClass("primary", "sm")}
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </>
      }
    >
      <div className="pt-1" />
      <Row label="Name" htmlFor="settings-repo-name" hint="Shown in the header, the repository list and exports.">
        <input
          id="settings-repo-name"
          value={name}
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={nameMissing}
          className={`${fieldClass} aria-[invalid=true]:border-red-500`}
        />
        {nameMissing ? (
          <p className="mt-1.5 text-[13px] text-red-700 dark:text-red-300">A repository needs a name.</p>
        ) : null}
      </Row>
      <Row
        label="Description"
        htmlFor="settings-repo-description"
        hint="One or two sentences on what the collection is for. Shown under the name on the repository's home."
      >
        <textarea
          id="settings-repo-description"
          value={description}
          rows={3}
          maxLength={500}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="For example: Thai EFL research on speaking assessment, 2010 to 2025."
          className={`${fieldClass} resize-y leading-6`}
        />
        <p className={`${hintClass} text-right tabular-nums`}>{description.length}/500</p>
      </Row>
      <Row label="Repository ID" hint="Quote this when you report a problem with this repository.">
        <div className="flex min-w-0 items-center gap-2">
          <code className="min-w-0 truncate rounded-md bg-subtle px-2 py-1.5 font-mono text-xs text-body">
            {currentProject.id}
          </code>
          <button type="button" onClick={() => void copyId()} className={buttonClass("ghost", "sm", "flex-none")}>
            {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </Row>
      <Row label="Created">
        <p className="flex min-h-9 items-center text-sm text-ink">{formatDate(currentProject.created_at) || "Not available"}</p>
      </Row>
      <Row label="Other repositories" hint="Each repository keeps its own papers, dashboard and chat.">
        <Link href="/workspaces" className={buttonClass("secondary", "sm")}>
          Switch or create a repository
          <ArrowRightIcon className="h-3.5 w-3.5" />
        </Link>
      </Row>
    </Section>
  );
}

type ReclassificationJob = {
  id: string;
  status: string;
  total_items: number;
  processed_items: number;
  failed_items: number;
  error_message?: string | null;
};

function AnalysisSection({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { currentProject, allProjects, updateProjectAnalysisProfile } = useWorkspaceProfile();
  const { session } = useAuth();
  const [profileDraft, setProfileDraft] = useState<ProjectAnalysisProfile>(createGeneralAnalysisProfile);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [classificationCoverage, setClassificationCoverage] = useState({ classified: 0, previousProfile: 0, unclassified: 0, failed: 0 });
  const [coverageRevision, setCoverageRevision] = useState(0);
  const [reclassificationJob, setReclassificationJob] = useState<ReclassificationJob | null>(null);
  const [reclassificationBusy, setReclassificationBusy] = useState(false);
  const currentProjectId = currentProject?.id ?? null;
  const reclassificationJobId = reclassificationJob?.id ?? null;
  const reclassificationJobStatus = reclassificationJob?.status ?? null;

  const savedProjectProfile = useMemo(
    () => currentProject?.analysis_profile ?? createGeneralAnalysisProfile(),
    [currentProject]
  );
  const profileDirty = JSON.stringify(profileDraft) !== JSON.stringify(savedProjectProfile);
  const jobRunning = Boolean(reclassificationJob && ["queued", "processing"].includes(reclassificationJob.status));
  const needsReclassification = classificationCoverage.previousProfile + classificationCoverage.unclassified;

  useEffect(() => onDirtyChange(profileDirty), [onDirtyChange, profileDirty]);

  useEffect(() => {
    setProfileDraft(savedProjectProfile);
    setProfileError(null);
  }, [savedProjectProfile]);

  useEffect(() => {
    if (!currentProjectId || !session?.access_token) return;
    fetch(`/api/workspace/projects/${encodeURIComponent(currentProjectId)}/analysis-profile`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    }).then(async (response) => {
      const payload = await response.json() as { coverage?: typeof classificationCoverage };
      if (response.ok && payload.coverage) setClassificationCoverage(payload.coverage);
    }).catch(() => undefined);
  }, [coverageRevision, currentProjectId, session?.access_token]);

  async function saveAnalysisProfile() {
    if (!currentProject) return;
    setSavingProfile(true);
    setProfileError(null);
    try {
      const normalized = sanitizeProjectAnalysisProfile(profileDraft);
      await updateProjectAnalysisProfile(currentProject.id, normalized);
      setProfileDraft(normalized);
      setCoverageRevision((revision) => revision + 1);
      setMessage("Saved. New uploads use this profile straight away.");
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Could not save the analysis profile.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function startReclassification() {
    if (!currentProject || !session?.access_token || profileDirty) return;
    setReclassificationBusy(true);
    setProfileError(null);
    try {
      const response = await fetch(`/api/workspace/projects/${encodeURIComponent(currentProject.id)}/reclassify`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const payload = await response.json() as { jobId?: string; error?: string };
      if (!response.ok || !payload.jobId) throw new Error(payload.error ?? "Could not start reclassification.");
      setReclassificationJob({ id: payload.jobId, status: "queued", total_items: 0, processed_items: 0, failed_items: 0 });
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Could not start reclassification.");
    } finally {
      setReclassificationBusy(false);
    }
  }

  async function updateReclassification(action: "cancel" | "retry") {
    if (!currentProject || !session?.access_token || !reclassificationJob) return;
    setReclassificationBusy(true);
    setProfileError(null);
    try {
      const response = await fetch(`/api/workspace/projects/${encodeURIComponent(currentProject.id)}/reclassify/${encodeURIComponent(reclassificationJob.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action }),
      });
      const payload = await response.json() as { job?: ReclassificationJob; error?: string };
      if (!response.ok || !payload.job) throw new Error(payload.error ?? `Could not ${action} reclassification.`);
      setReclassificationJob(payload.job);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : `Could not ${action} reclassification.`);
    } finally {
      setReclassificationBusy(false);
    }
  }

  useEffect(() => {
    if (!currentProjectId || !session?.access_token || !reclassificationJobId || !reclassificationJobStatus || !["queued", "processing"].includes(reclassificationJobStatus)) return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/workspace/projects/${encodeURIComponent(currentProjectId)}/reclassify/${encodeURIComponent(reclassificationJobId)}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const payload = await response.json() as { job?: ReclassificationJob };
        if (response.ok && payload.job) {
          setReclassificationJob(payload.job);
          if (payload.job.status === "succeeded") setClassificationCoverage((current) => ({ ...current, classified: payload.job!.total_items, previousProfile: 0, unclassified: 0 }));
        }
      } catch {
        // A transient refresh failure should not change or cancel the server job.
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [currentProjectId, reclassificationJobId, reclassificationJobStatus, session?.access_token]);

  const coverage: Array<[string, number, string]> = [
    ["Classified", classificationCoverage.classified, "with the current profile"],
    ["Previous profile", classificationCoverage.previousProfile, "classified before the last change"],
    ["Unclassified", classificationCoverage.unclassified, "not yet given a category"],
    ["Failed analyses", classificationCoverage.failed, "cannot be classified until re-analyzed"],
  ];
  const jobPercent = reclassificationJob?.total_items
    ? Math.round((reclassificationJob.processed_items / reclassificationJob.total_items) * 100)
    : 2;

  return (
    <div className="space-y-6">
      <Section
        title="Analysis & classification"
        description="This profile belongs to this repository. A change applies to new uploads at once; papers already analyzed keep their category until you reclassify them."
        footer={
          <>
            <div className="min-h-5 text-[13px]">
              {profileDirty ? (
                <span className="text-mute">Unsaved changes</span>
              ) : message ? (
                <span className="inline-flex items-center gap-1.5 text-body" role="status">
                  <CheckCircleIcon weight="fill" className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  {message}
                </span>
              ) : (
                <span className="text-mute">
                  Profile version {savedProjectProfile.version} · {savedProjectProfile.displayName}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!profileDirty || savingProfile}
                onClick={() => {
                  setProfileDraft(savedProjectProfile);
                  setProfileError(null);
                }}
                className={buttonClass("ghost", "sm")}
              >
                Discard
              </button>
              <button
                type="button"
                disabled={!profileDirty || savingProfile || !currentProject}
                onClick={() => void saveAnalysisProfile()}
                className={buttonClass("primary", "sm")}
              >
                {savingProfile ? "Saving..." : "Save profile"}
              </button>
            </div>
          </>
        }
      >
        <div className="pt-5">
          <AnalysisProfileEditor
            value={profileDraft}
            onChange={(next) => {
              setProfileDraft(next);
              setProfileError(null);
              setMessage(null);
            }}
            templates={allProjects
              .filter((project) => project.id !== currentProject?.id && project.analysis_profile)
              .map((project) => ({ projectId: project.id, projectName: project.name, profile: project.analysis_profile! }))}
            error={profileError}
          />
        </div>
      </Section>

      <Section
        title="Existing papers"
        description="Reclassifying reads each analyzed paper again against the saved profile. It does not re-run the full analysis, and the previous categories stay in place until every paper has a new one."
      >
        <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-hairline bg-hairline sm:grid-cols-4">
          {coverage.map(([label, value, hint]) => (
            <div key={label} className="bg-surface px-4 py-3.5">
              <dt className="text-[13px] text-mute">{label}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums text-ink">{value.toLocaleString()}</dd>
              <dd className="mt-0.5 text-xs leading-4 text-mute">{hint}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] leading-5 text-body">
            {profileDirty
              ? "Save the profile first, so papers are classified against what you see."
              : needsReclassification > 0
                ? `${needsReclassification} paper${needsReclassification === 1 ? "" : "s"} can be brought up to date.`
                : "Every analyzed paper already uses the current profile."}
          </p>
          <button
            type="button"
            disabled={profileDirty || savingProfile || reclassificationBusy || needsReclassification === 0 || jobRunning}
            onClick={() => void startReclassification()}
            className={buttonClass("secondary", "sm")}
          >
            {reclassificationBusy ? "Starting..." : jobRunning ? "Reclassifying..." : "Reclassify existing papers"}
          </button>
        </div>

        {reclassificationJob ? (
          <div className="mt-4 rounded-xl bg-subtle px-4 py-3.5" role="status">
            <div className="flex justify-between gap-3 text-[13px] text-body">
              <span>
                {reclassificationJob.status === "succeeded"
                  ? "Published. Every paper now uses the current profile."
                  : reclassificationJob.status === "failed"
                    ? "Stopped. The previous categories are kept."
                    : reclassificationJob.status === "canceled"
                      ? "Canceled. The previous categories are kept."
                      : "Classifying analyzed papers..."}
              </span>
              <span className="tabular-nums text-mute">
                {reclassificationJob.processed_items}/{reclassificationJob.total_items || "..."}
              </span>
            </div>
            <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-hairline">
              <div
                className="h-full origin-left rounded-full bg-ink transition-transform duration-500 ease-out-expo"
                style={{ transform: `scaleX(${jobPercent / 100})` }}
              />
            </div>
            {reclassificationJob.error_message ? (
              <p className="mt-2 text-xs text-red-700 dark:text-red-300">{reclassificationJob.error_message}</p>
            ) : null}
            <div className="mt-3 flex justify-end">
              {jobRunning ? (
                <button type="button" disabled={reclassificationBusy} onClick={() => void updateReclassification("cancel")} className={buttonClass("ghost", "sm")}>
                  Cancel reclassification
                </button>
              ) : reclassificationJob.status === "failed" ? (
                <button type="button" disabled={reclassificationBusy} onClick={() => void updateReclassification("retry")} className={buttonClass("secondary", "sm")}>
                  Retry failed papers
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </Section>
    </div>
  );
}

/* ---------------------------------------------------------------- the page */

export default function WorkspaceSettingsClient() {
  const searchParams = useSearchParams();
  const { currentProject } = useWorkspaceProfile();
  const [activeSection, setActiveSection] = useState<SectionId>(() => resolveSection(searchParams.get("section")));
  const [analysisDirty, setAnalysisDirty] = useState(false);

  useEffect(() => {
    setActiveSection(resolveSection(searchParams.get("section")));
  }, [searchParams]);

  useEffect(() => {
    if (!analysisDirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    const warnLinkNavigation = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (target && !window.confirm("Discard unsaved analysis profile changes?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", warnLinkNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", warnLinkNavigation, true);
    };
  }, [analysisDirty]);

  function selectSection(id: SectionId) {
    if (id === activeSection) return;
    if (activeSection === "analysis" && analysisDirty && !window.confirm("Discard unsaved analysis profile changes?")) {
      return;
    }
    setActiveSection(id);
    setAnalysisDirty(false);
    const params = new URLSearchParams(window.location.search);
    params.set("section", id);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  const groups = (["Account", "Repository"] as const).map((group) => ({
    group,
    items: VISIBLE_SECTIONS.filter((section) => section.group === group),
  }));
  const active = VISIBLE_SECTIONS.find((section) => section.id === activeSection) ?? VISIBLE_SECTIONS[0];

  return (
    <div className="mx-auto max-w-[1080px] pb-16 pt-2 sm:pt-4">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Settings</h1>
        <p className="mt-2 text-[15px] leading-7 text-body">
          Your account, and the repository you have open
          {currentProject ? (
            <>
              : <span className="font-medium text-ink">{currentProject.name}</span>
            </>
          ) : null}
          .
        </p>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-12">
        <nav aria-label="Settings sections" className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          {/* A phone gets one scrolling row; a desktop gets the grouped list. */}
          <div className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 lg:hidden">
            {VISIBLE_SECTIONS.map((section) => {
              const selected = section.id === activeSection;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => selectSection(section.id)}
                  aria-current={selected ? "page" : undefined}
                  className={`flex-none rounded-full px-3.5 py-2 text-sm transition-colors duration-150 ${
                    selected ? "bg-ink font-medium text-canvas" : "text-body hover:bg-subtle hover:text-ink"
                  }`}
                >
                  {section.label}
                </button>
              );
            })}
          </div>
          <div className="hidden space-y-6 lg:block">
            {groups.map(({ group, items }) => (
              <div key={group}>
                <p className="px-3 text-xs font-medium text-mute">
                  {group}
                  {group === "Repository" && currentProject ? (
                    <span className="mt-0.5 block truncate font-normal" title={currentProject.name}>
                      {currentProject.name}
                    </span>
                  ) : null}
                </p>
                <ul className="mt-2 space-y-0.5">
                  {items.map((section) => {
                    const selected = section.id === activeSection;
                    const Icon = section.icon;
                    return (
                      <li key={section.id}>
                        <button
                          type="button"
                          onClick={() => selectSection(section.id)}
                          aria-current={selected ? "page" : undefined}
                          className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150 ${
                            selected ? "bg-subtle font-medium text-ink" : "text-body hover:bg-subtle/70 hover:text-ink"
                          }`}
                        >
                          <Icon className={`h-4 w-4 flex-none ${selected ? "text-ink" : "text-mute"}`} />
                          {section.label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            <Link
              href="/docs/account-and-settings"
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-body transition-colors hover:bg-subtle/70 hover:text-ink"
            >
              <BookOpenIcon className="h-4 w-4 text-mute" />
              Settings guide
            </Link>
          </div>
        </nav>

        <div key={active.id} className="min-w-0 motion-safe:animate-rise-in">
          <p className="mb-4 text-[13px] text-mute lg:hidden">{active.description}</p>
          {active.id === "profile" ? <ProfileSection /> : null}
          {active.id === "security" ? <SecuritySection /> : null}
          {active.id === "appearance" ? <AppearanceSection /> : null}
          {active.id === "repository" ? <RepositorySection /> : null}
          {active.id === "analysis" && PROJECT_ANALYSIS_PROFILES_ENABLED ? (
            <AnalysisSection onDirtyChange={setAnalysisDirty} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
