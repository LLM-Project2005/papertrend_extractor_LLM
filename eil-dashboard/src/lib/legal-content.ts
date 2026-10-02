/*
 * The Privacy Policy and Terms of Service, as data. Every statement here
 * describes what the code and the deployment actually do (checked on
 * 2026-10-02); if the system changes, this text must change with it.
 * tests/legal-providers.test.ts fails when a sign-in method or an outside
 * service is added to the code without being named here.
 */

export const LEGAL_CONTACT_EMAIL = "p.chantarusorn@gmail.com";
export const LEGAL_EFFECTIVE_DATE = "2 October 2026";

export interface LegalSection {
  id: string;
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
}

export interface LegalDocument {
  slug: "privacy" | "terms";
  title: string;
  description: string;
  intro: string[];
  sections: LegalSection[];
}

export const privacyPolicy: LegalDocument = {
  slug: "privacy",
  title: "Privacy Policy",
  description:
    "What personal data Papertrend collects, why, who processes it, how long it is kept, and your rights under Thailand's Personal Data Protection Act.",
  intro: [
    "Papertrend is a research tool: you upload research papers, it analyses them, charts the results and answers questions with citations. This policy explains what personal data Papertrend collects, why, who processes it, how long it is kept, and the rights you have under Thailand's Personal Data Protection Act B.E. 2562 (PDPA).",
    `Papertrend is the data controller for the personal data described here. You can reach us at ${LEGAL_CONTACT_EMAIL}.`,
  ],
  sections: [
    {
      id: "what-we-collect",
      heading: "What we collect",
      bullets: [
        "Your account: your email address, your name and profile picture (from Google or Facebook sign-in, or as you enter them), how you sign in (Google, Facebook, or email and password), the invite code you joined with, and the settings you save, such as your organisation, research domain and analysis categories.",
        "What you add: the PDF files you upload or choose from Google Drive, the text extracted from them, the analysis results (titles, years, keywords, topics, categories), your repository and folder names, and your chat questions, answers and research sessions.",
        "Usage and security records: how many times a day your account uses each AI feature, and the tokens and model fees each AI request used (to apply fair-use and daily spending limits), a one-way hash of your IP address and email address when you sign in (to limit repeated failed attempts), and server request logs kept by Google Cloud (IP address, browser type, the address requested and the time).",
        "If you request access without an account: the name, email address, affiliation and intended use you enter, and whether we sent you an invite code.",
        "We do not use advertising or analytics trackers.",
      ],
    },
    {
      id: "how-we-use-it",
      heading: "How we use it",
      bullets: [
        "To provide the service you ask for: storing your papers, analysing them, showing dashboards and answering your questions.",
        "To keep the service secure and fair: signing you in, applying rate and usage limits, preventing abuse and fixing problems.",
        "To decide on an access request, and to email an invite code to the address it gives.",
        "We do not sell personal data, use it for advertising, or use your papers to train AI models.",
      ],
      paragraphs: [
        "We process your data because it is necessary to provide the service you requested (contract), because we have a legitimate interest in keeping the service secure, and, where the law requires it, with your consent, which you can withdraw at any time.",
      ],
    },
    {
      id: "ai-processing",
      heading: "How papers and questions are processed by AI",
      bullets: [
        "To analyse a paper, its text (and, for scanned pages, images of those pages) is sent to AI model providers through OpenRouter, a service that routes requests to models from companies such as OpenAI and Google. Chat questions, together with the relevant passages from your papers, are sent the same way to write answers, and text is sent the same way to build search indexes and the semantic map.",
        "If you turn on web search in chat, your question, a search query made from it and the answer drafted from your papers are sent through OpenRouter to a model that searches the web with Exa, a web search provider. Exa receives the search query.",
        "Deep research decides on its own whether a question needs the web, for example when it asks about current policy or about research beyond your papers. When it does, your question and search queries made from it are sent through OpenRouter to a model that searches with Exa. The text of your papers is not sent to the web search, and pages it finds are cited in the report as web sources, apart from your papers.",
        "To find a paper's publication year, its title or DOI may be sent to Crossref and OpenAlex, which are public bibliographic databases.",
        "These providers receive only what a request needs. Their own terms and privacy policies govern how they handle it.",
      ],
    },
    {
      id: "google-drive",
      heading: "Google Drive and other Google user data",
      bullets: [
        "If you choose to import from Google Drive, Papertrend asks Google for access only to the files you pick (the drive.file permission). It cannot see or open anything else in your Drive.",
        "The files you pick are downloaded by your browser and stored in Papertrend like any other upload, then analysed as described above. The Google access token stays in your browser's memory for that session and is never stored on Papertrend's servers.",
        "If you sign in with Google, Papertrend receives your name, email address and profile picture, and uses them only for your account.",
        "Papertrend's use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements. Google user data is used only to provide the features you use, is not used for advertising, and is not sold or transferred to others except as needed to provide those features, as described in this policy.",
      ],
    },
    {
      id: "facebook-sign-in",
      heading: "Facebook sign-in",
      bullets: [
        "If you sign in with Facebook, Meta (the company behind Facebook) shares your name, email address and profile picture with Papertrend through Firebase Authentication. Papertrend uses them only for your account.",
        "Papertrend asks only for your public profile and email address. It does not post to Facebook or read your friends, pages or anything else in your Facebook account.",
        "You can remove Papertrend's access in your Facebook settings, under Apps and Websites. To have the account data Papertrend holds deleted, see Your rights below.",
      ],
    },
    {
      id: "where-it-is-stored",
      heading: "Where data is stored and who processes it",
      bullets: [
        "Google Cloud hosts the service, the database and the stored files, in Singapore (asia-southeast1). Firebase Authentication, a Google service, handles sign-in with Google, Facebook, or email and password, and sends the emails that confirm an address or reset a password.",
        "Meta handles sign-in with Facebook for those who choose it.",
        "OpenRouter and the AI model providers it routes to, such as OpenAI and Google, process paper text and questions, and may do so in other countries, including the United States.",
        "Exa receives web search queries, when chat web search is on or deep research searches the web.",
        "Crossref and OpenAlex receive paper titles or DOIs only.",
      ],
      paragraphs: [
        "Using these providers means your data is processed outside Thailand. We use them only to run Papertrend, under their terms of service.",
      ],
    },
    {
      id: "how-long",
      heading: "How long we keep it",
      bullets: [
        "Papers, analysis results and chats: until you delete them. Deleting a paper from Trash (\"Delete permanently\" or \"Empty Trash\") removes the PDF and everything derived from it. Deleting a chat removes it.",
        "Backups: database backups are kept for 7 days, so deleted data can remain in a backup for up to 7 days before it is gone.",
        "Server request logs: 30 days.",
        "Usage counts, AI spending records and sign-in rate-limit hashes: for as long as they are needed to apply limits and prevent abuse.",
        "Access requests: 180 days from when you send one, whether or not you were invited; sooner if you ask us to delete it.",
        "Your account: until you ask us to delete it.",
      ],
    },
    {
      id: "your-rights",
      heading: "Your rights",
      paragraphs: [
        "Under the PDPA you have the right to access your personal data and get a copy, to have it corrected, to have it deleted, to object to or restrict its processing, to receive it in a portable format, and to withdraw consent you have given. You can also complain to the Office of the Personal Data Protection Committee (PDPC).",
        `You can edit your profile in Settings and delete papers and chats yourself. To delete your account, or to exercise any other right, email ${LEGAL_CONTACT_EMAIL} from the address you sign in with. We aim to respond within 30 days.`,
      ],
    },
    {
      id: "security",
      heading: "Security",
      paragraphs: [
        "Connections are encrypted, each account can reach only its own data, stored data is encrypted by Google Cloud, and access to the systems is limited to what each part needs. No system is perfectly secure, and we cannot guarantee that data will never be exposed.",
      ],
    },
    {
      id: "children",
      heading: "Children",
      paragraphs: [
        "Papertrend is meant for university students, researchers and staff. It is not intended for children.",
      ],
    },
    {
      id: "browser-storage",
      heading: "Cookies and browser storage",
      paragraphs: [
        "Papertrend does not use advertising or analytics cookies. Your browser stores your sign-in session (through Firebase) and a few preferences, such as your theme and the repository you last opened.",
      ],
    },
    {
      id: "changes",
      heading: "Changes to this policy",
      paragraphs: [
        "When this policy changes, the date at the top changes too. Significant changes will be announced on the site.",
      ],
    },
    {
      id: "contact",
      heading: "Contact",
      paragraphs: [`Questions or requests about your data: ${LEGAL_CONTACT_EMAIL}.`],
    },
  ],
};

export const termsOfService: LegalDocument = {
  slug: "terms",
  title: "Terms of Service",
  description: "The terms for using Papertrend: your account, your content, acceptable use, limits and the nature of AI-generated results.",
  intro: [
    "These terms apply when you use Papertrend. By creating an account or using the service, you agree to them. If you do not agree, please do not use Papertrend.",
  ],
  sections: [
    {
      id: "service",
      heading: "The service",
      paragraphs: [
        "Papertrend lets you upload research papers, analyses them automatically, shows the results on dashboards and answers questions about them with citations. It is a research project, and its features may change over time.",
      ],
    },
    {
      id: "account",
      heading: "Your account",
      bullets: [
        "Give accurate information when you sign up, and keep your password safe.",
        "You are responsible for what happens under your account. Tell us at once if you think someone else has used it.",
      ],
    },
    {
      id: "your-content",
      heading: "Your content",
      bullets: [
        "You keep ownership of the papers and other material you add.",
        "You allow Papertrend to store and process your content, including sending it to the AI providers described in the Privacy Policy, only to provide the service to you.",
        "Upload only papers you have the right to use this way, for example under their licence or for your own research.",
      ],
    },
    {
      id: "acceptable-use",
      heading: "Acceptable use",
      paragraphs: ["Do not use Papertrend to:"],
      bullets: [
        "break the law or infringe anyone's rights;",
        "upload malicious files, or files made to disrupt or overload the service;",
        "try to reach other people's accounts or data, or get around security measures;",
        "get around usage limits, for example by creating many accounts;",
        "scrape, copy or resell the service, or send automated traffic that burdens it.",
      ],
    },
    {
      id: "limits",
      heading: "Limits",
      paragraphs: [
        "Accounts have usage limits, such as the number of papers stored, how often AI features can be used each day, and how much each account's AI requests may cost in a day. The whole site has a daily AI spending limit too: when it is reached, AI features pause and uploaded papers wait until the next day (midnight UTC). The limits keep the service fair and affordable, and they may change.",
      ],
    },
    {
      id: "ai-results",
      heading: "AI-generated results",
      paragraphs: [
        "Analyses, charts and answers are produced automatically and can be wrong or incomplete. Check them against the cited papers before relying on them. They are not professional or academic advice.",
      ],
    },
    {
      id: "google-drive",
      heading: "Google Drive",
      paragraphs: [
        "Importing from Google Drive is optional. When you use it, Google's terms also apply to your use of Google's services.",
      ],
    },
    {
      id: "availability",
      heading: "Availability",
      paragraphs: [
        "Papertrend is provided \"as is\" and \"as available\". We do not promise it will always be available or free of errors, and it may change, pause or end. Keep your own copies of your papers.",
      ],
    },
    {
      id: "liability",
      heading: "Liability",
      paragraphs: [
        "To the extent the law allows, Papertrend is not liable for indirect or consequential losses, or for loss of data, arising from your use of the service. Nothing in these terms limits liability that cannot be limited by law.",
      ],
    },
    {
      id: "ending",
      heading: "Suspension and ending",
      paragraphs: [
        "We may suspend or close an account that breaks these terms. You can stop using Papertrend at any time and ask us to delete your account.",
      ],
    },
    {
      id: "changes",
      heading: "Changes to these terms",
      paragraphs: [
        "When these terms change, the date at the top changes too. Continuing to use Papertrend after a change means you accept the updated terms.",
      ],
    },
    {
      id: "law",
      heading: "Governing law",
      paragraphs: ["These terms are governed by the laws of Thailand."],
    },
    {
      id: "contact",
      heading: "Contact",
      paragraphs: [`Questions about these terms: ${LEGAL_CONTACT_EMAIL}.`],
    },
  ],
};
