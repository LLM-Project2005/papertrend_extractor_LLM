import type { DocsCategoryBase } from "./types";

export const accountCategory: DocsCategoryBase = {
  id: "account",
  label: "Account and privacy",
  description: "Signing in, your settings, and what happens to the papers you upload.",
  pages: [
    {
      slug: "account-and-settings",
      title: "Account and settings",
      description:
        "Signing in and out, passwords, your profile and theme, and every setting for a repository, section by section.",
      tags: ["account", "sign in", "password", "settings", "theme", "profile"],
      related: ["privacy-and-data", "analysis-profiles", "troubleshooting"],
      sections: [
        {
          id: "signing-in",
          title: "Signing in",
          body: [
            "The sign-in page offers three ways in: **Continue with Google**, **Continue with Facebook**, and email with password. Google and Facebook open a small pop-up window; if your browser blocks pop-ups, allow them for this site.",
            "If you opened a workspace page while signed out, you return to it after signing in. Otherwise you arrive at the last page you had open, or at your list of repositories.",
            "You stay signed in on this device until you sign out.",
          ],
          subsections: [
            {
              title: "Creating an account",
              body: [
                "Signing in with Google creates your account the first time. For email and password, choose **Create password account**, add your name, and **Create account**. If an account with the same email already exists, the new sign-in method is attached to it rather than creating a second account.",
                "If Papertrend then shows `This Firebase account is not linked to a Papertrend owner account yet`, the new account has not been approved for a workspace yet; see [Troubleshooting](/docs/troubleshooting#signing-in).",
              ],
            },
          ],
        },
        {
          id: "passwords",
          title: "Passwords",
          body: [
            "To reset a forgotten password, type your email on the sign-in page and choose **Reset password**; if that address has an account, a reset link is emailed to it. When you are signed in, **Settings > Sign-in & security > Email me a reset link** does the same.",
            "Passwords need at least 8 characters. There is no form to change a password or your sign-in email inside the app; a reset link is how you choose a new password. Accounts that sign in with Google or Facebook have no Papertrend password.",
          ],
        },
        {
          id: "signing-out",
          title: "Signing out",
          body: [
            "Choose **Sign out** in the account menu (your initials at the top right) or in **Settings > Sign-in & security**. Signing out ends the session in this browser only. Nothing is deleted, and your theme and last-opened repository stay remembered in this browser.",
          ],
        },
        {
          id: "settings-overview",
          title: "The Settings page",
          body: [
            "**Settings** has two groups. **Account** holds things that follow you into every repository; **Repository** holds settings for the repository you have open, named under the group heading. On a phone the sections are a row of tabs across the top.",
          ],
        },
        {
          id: "profile",
          title: "Account > Profile",
          body: ["How you appear in the workspace header and the account menu."],
          table: {
            columns: ["Setting", "Details"],
            rows: [
              ["**Display name**", "Up to 120 characters."],
              ["**Picture**", "A link to a square image that starts with `https://`. Leave it empty to show your initials. There is no file upload."],
              ["**Email**", "Your sign-in address, shown for reference. It cannot be changed here."],
            ],
          },
        },
        {
          id: "security",
          title: "Account > Sign-in & security",
          body: [],
          table: {
            columns: ["Row", "What it shows or does"],
            rows: [
              ["**Signed in as**", "Your email, with **Verified** when the address is confirmed."],
              ["**Sign-in method**", "Email and password, Google or Facebook."],
              ["**Password**", "**Email me a reset link** for password accounts."],
              ["**Account**", "When you joined, your last sign-in, and your role (Member or Admin)."],
              ["**This device**", "**Sign out** of this browser."],
            ],
          },
        },
        {
          id: "appearance",
          title: "Account > Appearance",
          body: [
            "Choose **Light**, **Dark** or **System**. System follows your device and changes with it, for example when the device switches to dark mode at night. The choice applies straight away and is stored in this browser, so another device keeps its own. The moon or sun button in the workspace header switches between light and dark quickly.",
            "Animations follow your device's reduced-motion setting: with it on, progress bars and page transitions stop moving but still show their state.",
          ],
        },
        {
          id: "repository-general",
          title: "Repository > General",
          body: ["Settings for the repository you have open."],
          table: {
            columns: ["Setting", "Details"],
            rows: [
              ["**Name**", "Up to 120 characters. Shown in the header and the repository list."],
              ["**Description**", "Up to 500 characters. Shown under the name on the repository's Home page."],
              ["**Repository ID**", "Copy it when you report a problem with this repository."],
              ["**Created**", "The date the repository was made."],
            ],
          },
          callout: {
            tone: "info",
            title: "Changes need saving",
            body: "Profile, General and Analysis settings each have **Discard** and **Save** at the bottom of their panel, and say **Unsaved changes** until you save.",
          },
        },
        {
          id: "repository-analysis",
          title: "Repository > Analysis & classification",
          body: [
            "The repository's analysis profile, which decides how its papers are categorized, and the tools to bring existing papers up to date after a change. [Analysis profiles](/docs/analysis-profiles) explains each profile and what reclassifying does.",
            "Leaving this section with unsaved changes asks whether to discard them.",
          ],
          figure: {
            shot: "settings-analysis",
            alt: "Settings > Analysis & classification with the EIL Tracks profile selected and its three official categories.",
          },
        },
        {
          id: "roles",
          title: "Member and Admin",
          body: [
            "Every account is a **Member** or an **Admin**. Admins are exempt from the daily AI limits and the 50-paper allowance; otherwise the two work the same, and an admin cannot see anyone else's papers. Roles are set by whoever runs your Papertrend, not in the app.",
          ],
        },
      ],
    },
    {
      slug: "privacy-and-data",
      title: "Privacy and your data",
      description:
        "Where your papers are stored, who can see them, what is sent to AI models, and what can and cannot be deleted.",
      tags: ["privacy", "data", "storage", "delete", "ai models"],
      related: ["account-and-settings", "repositories"],
      sections: [
        {
          id: "who-can-see",
          title: "Who can see your papers",
          body: [
            "Only you. Every repository, paper, chart and chat belongs to the account that created it, and every request is checked against the signed-in account before anything is returned. There is no sharing, team or invitation feature, and an admin role does not open anyone else's papers.",
            "The public pages (the front page, the feature pages and these docs) need no sign-in and contain no one's data.",
          ],
        },
        {
          id: "where-stored",
          title: "Where things are stored",
          body: ["Papertrend runs on Google Cloud in Singapore (asia-southeast1)."],
          table: {
            columns: ["What", "Where"],
            rows: [
              ["Your PDFs", "A private Google Cloud Storage bucket. Files go there straight from your browser over a link that lasts 30 minutes; previews and downloads use links that last an hour."],
              ["Everything else", "A PostgreSQL database: your profile, repositories, the text extracted from each paper, keywords, topics, categories, chat conversations and usage counters."],
              ["Your sign-in", "Firebase Authentication, which holds your email, provider links and, for password accounts, a password hash."],
              ["This browser", "Your theme, last repository and page, and the progress tray. Not cleared when you sign out."],
            ],
          },
        },
        {
          id: "ai-models",
          title: "What is sent to AI models",
          body: [
            "Analysis and chat use large language models reached through OpenRouter, which passes each request to a model provider.",
          ],
          bullets: [
            "**During analysis**, the paper's text (and page images for scanned pages) is sent for text extraction, translation, metadata, keywords, topics, research type, facets and classification.",
            "**In Chat**, your question is sent with the passages and details retrieved from your papers. With web search on, the search query goes to the search provider too.",
            "**For search and the semantic map**, passages of paper text are turned into embeddings.",
            "**On the dashboard**, topic labels and paper titles are sent to group topics into themes.",
          ],
          callout: {
            tone: "info",
            title: "Retention by model providers",
            body: "How long a model provider keeps a request depends on the provider's own terms and the OpenRouter account settings; Papertrend does not set a no-retention option on each request. Avoid uploading material you are not permitted to share with such services.",
          },
        },
        {
          id: "deleting",
          title: "What can be deleted",
          body: [],
          table: {
            columns: ["Action", "Possible?", "How"],
            rows: [
              ["Move a paper to Trash, or restore it", "Yes", "The paper's **...** menu in the Library"],
              ["Delete a paper or its PDF permanently", "No", "Papers in Trash stay stored"],
              ["Empty Trash", "No", ""],
              ["Delete a repository", "No", ""],
              ["Delete a chat conversation", "Yes", "In Chat (see [Research chat](/docs/chat))"],
              ["Remove your name or picture", "Yes", "Clear the fields in **Settings > Profile**"],
              ["Delete your account", "No", "Ask whoever runs your Papertrend"],
            ],
          },
          callout: {
            tone: "warning",
            title: "Backups",
            body: "Do not rely on Papertrend as the only copy of your papers. Keep your own copies of the PDFs you upload.",
          },
        },
      ],
    },
  ],
};
