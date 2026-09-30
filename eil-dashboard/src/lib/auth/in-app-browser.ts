/**
 * Browsers built into other apps - LINE, Facebook, Instagram, and the like -
 * block the Google and Facebook sign-in window (docs/32, 2.11, AUTH-2). A
 * sign-in by redirect instead is no help: this site's sign-in service lives
 * on another domain, and these browsers do not keep its storage, so the
 * reader would come back signed out. They are told to open the page in their
 * browser; email and password sign-in works where they are.
 */
const IN_APP_BROWSER = /\b(FBAN|FBAV|FB_IAB|FBIOS|Instagram|Line\/|LinkedInApp|MicroMessenger|KAKAOTALK|Snapchat|TikTok|musical_ly|BytedanceWebview)\b|;\s?wv\)/i;

export function isInAppBrowser(userAgent: string | null | undefined): boolean {
  return Boolean(userAgent && IN_APP_BROWSER.test(userAgent));
}

export const IN_APP_BROWSER_NOTICE =
  "This app's built-in browser blocks Google and Facebook sign-in. Open this page in your browser (Chrome or Safari) to use them; email sign-in works here.";
