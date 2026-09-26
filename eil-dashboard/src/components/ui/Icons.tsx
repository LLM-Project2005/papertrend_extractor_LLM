/*
 * One icon family for the whole product: Phosphor, at one weight.
 *
 * The exports keep the names the app already imports, so a call site never
 * changes when a glyph does. Phosphor's SSR entry is used because it reads no
 * React context, which lets these render in server components (the marketing
 * pages and docs) as well as client ones.
 *
 * Sizing comes from the caller's classes (h-4 w-4 and so on); CSS width and
 * height override the 1em attributes Phosphor writes. Colour is currentColor.
 *
 * Brand marks (Papertrend's own logo, Google, Facebook, Microsoft) are drawn
 * here as authored logos, not glyphs: a person scanning for the Google "G" is
 * looking for that exact object.
 */
import type { Icon as PhosphorGlyph } from "@phosphor-icons/react";
import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowLeftIcon as PhArrowLeft,
  ArrowRightIcon as PhArrowRight,
  ArrowSquareOutIcon,
  ArrowUpRightIcon as PhArrowUpRight,
  ArrowsDownUpIcon,
  ArrowsInIcon,
  ArrowsOutIcon,
  BookOpenIcon as PhBookOpen,
  BooksIcon as PhBooks,
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CaretUpIcon,
  CaretUpDownIcon as PhCaretUpDown,
  ChartBarIcon,
  ChatCircleTextIcon,
  CheckCircleIcon as PhCheckCircle,
  CheckIcon as PhCheck,
  CircleHalfIcon,
  CircleIcon as PhCircle,
  CircleNotchIcon,
  ClockIcon as PhClock,
  CloudIcon as PhCloud,
  CopyIcon as PhCopy,
  DatabaseIcon as PhDatabase,
  DotsThreeIcon,
  DownloadSimpleIcon,
  EnvelopeSimpleIcon,
  EyeIcon as PhEye,
  FileIcon as PhFile,
  FilePdfIcon as PhFilePdf,
  FileTextIcon,
  FolderIcon as PhFolder,
  FolderOpenIcon as PhFolderOpen,
  FunnelIcon,
  GearSixIcon,
  GlobeIcon as PhGlobe,
  GoogleDriveLogoIcon,
  HourglassIcon as PhHourglass,
  HouseIcon,
  ImageIcon as PhImage,
  InfoIcon as PhInfo,
  KeyIcon as PhKey,
  LightningIcon as PhLightning,
  ListBulletsIcon,
  ListIcon,
  LockIcon as PhLock,
  MagnifyingGlassIcon,
  MinusIcon as PhMinus,
  MonitorIcon as PhMonitor,
  MoonIcon as PhMoon,
  PaletteIcon as PhPalette,
  PaperPlaneRightIcon,
  PaperclipIcon,
  PencilSimpleIcon,
  PlusIcon as PhPlus,
  PushPinIcon,
  QuestionIcon as PhQuestion,
  ShieldCheckIcon as PhShieldCheck,
  SidebarSimpleIcon,
  SignOutIcon,
  SlidersHorizontalIcon,
  SparkleIcon,
  SquaresFourIcon,
  StackIcon as PhStack,
  StarIcon as PhStar,
  StopIcon as PhStop,
  SunIcon as PhSun,
  TagIcon as PhTag,
  TranslateIcon as PhTranslate,
  TrashIcon as PhTrash,
  UploadSimpleIcon,
  TreeStructureIcon as PhTreeStructure,
  UserCircleIcon as PhUserCircle,
  UserIcon as PhUser,
  WarningCircleIcon as PhWarningCircle,
  WarningIcon as PhWarning,
  XCircleIcon as PhXCircle,
  XIcon,
  AppleLogoIcon,
} from "@phosphor-icons/react/dist/ssr";

export type IconWeight = "regular" | "bold" | "fill";

export interface IconProps {
  className?: string;
  /** "fill" marks an on state, such as a favourite; "regular" everywhere else. */
  weight?: IconWeight;
}

function glyph(Glyph: PhosphorGlyph, name: string) {
  function Icon({ className, weight = "regular" }: IconProps) {
    return <Glyph aria-hidden="true" focusable="false" weight={weight} className={className} />;
  }
  Icon.displayName = name;
  return Icon;
}

/* ------------------------------------------------------------ navigation */

export const HomeIcon = glyph(HouseIcon, "HomeIcon");
export const ChartIcon = glyph(ChartBarIcon, "ChartIcon");
export const ChatIcon = glyph(ChatCircleTextIcon, "ChatIcon");
export const PaperIcon = glyph(FileTextIcon, "PaperIcon");
export const UploadIcon = glyph(UploadSimpleIcon, "UploadIcon");
export const SettingsIcon = glyph(GearSixIcon, "SettingsIcon");
export const MenuIcon = glyph(ListIcon, "MenuIcon");
export const SidebarIcon = glyph(SidebarSimpleIcon, "SidebarIcon");
export const BooksIcon = glyph(PhBooks, "BooksIcon");
export const BookOpenIcon = glyph(PhBookOpen, "BookOpenIcon");

/* ---------------------------------------------------------------- actions */

export const ArrowRightIcon = glyph(PhArrowRight, "ArrowRightIcon");
export const ArrowLeftIcon = glyph(PhArrowLeft, "ArrowLeftIcon");
export const ArrowUpRightIcon = glyph(PhArrowUpRight, "ArrowUpRightIcon");
export const ExternalLinkIcon = glyph(ArrowSquareOutIcon, "ExternalLinkIcon");
export const PlusIcon = glyph(PhPlus, "PlusIcon");
export const MinusIcon = glyph(PhMinus, "MinusIcon");
export const SendIcon = glyph(PaperPlaneRightIcon, "SendIcon");
export const CloseIcon = glyph(XIcon, "CloseIcon");
export const CopyIcon = glyph(PhCopy, "CopyIcon");
export const RefreshIcon = glyph(ArrowClockwiseIcon, "RefreshIcon");
export const UndoIcon = glyph(ArrowCounterClockwiseIcon, "UndoIcon");
export const AttachmentIcon = glyph(PaperclipIcon, "AttachmentIcon");
export const DownloadIcon = glyph(DownloadSimpleIcon, "DownloadIcon");
export const PencilSquareIcon = glyph(PencilSimpleIcon, "PencilSquareIcon");
export const TrashIcon = glyph(PhTrash, "TrashIcon");
export const PinIcon = glyph(PushPinIcon, "PinIcon");
export const StopIcon = glyph(PhStop, "StopIcon");
export const StarIcon = glyph(PhStar, "StarIcon");
export const LogoutIcon = glyph(SignOutIcon, "LogoutIcon");
export const FullscreenIcon = glyph(ArrowsOutIcon, "FullscreenIcon");
export const ExitFullscreenIcon = glyph(ArrowsInIcon, "ExitFullscreenIcon");
export const MoreHorizontalIcon = glyph(DotsThreeIcon, "MoreHorizontalIcon");

/* ------------------------------------------------------ direction, choice */

export const ChevronDownIcon = glyph(CaretDownIcon, "ChevronDownIcon");
export const ChevronUpIcon = glyph(CaretUpIcon, "ChevronUpIcon");
export const ChevronLeftIcon = glyph(CaretLeftIcon, "ChevronLeftIcon");
export const ChevronRightIcon = glyph(CaretRightIcon, "ChevronRightIcon");
export const CaretUpDownIcon = glyph(PhCaretUpDown, "CaretUpDownIcon");
export const CheckIcon = glyph(PhCheck, "CheckIcon");
export const CheckCircleIcon = glyph(PhCheckCircle, "CheckCircleIcon");
export const CircleIcon = glyph(PhCircle, "CircleIcon");
export const XCircleIcon = glyph(PhXCircle, "XCircleIcon");

/* --------------------------------------------------------- view controls */

export const FilterIcon = glyph(FunnelIcon, "FilterIcon");
export const EqualizerIcon = glyph(SlidersHorizontalIcon, "EqualizerIcon");
export const SearchIcon = glyph(MagnifyingGlassIcon, "SearchIcon");
export const ListViewIcon = glyph(ListBulletsIcon, "ListViewIcon");
export const GridViewIcon = glyph(SquaresFourIcon, "GridViewIcon");
export const SortIcon = glyph(ArrowsDownUpIcon, "SortIcon");
export const EyeIcon = glyph(PhEye, "EyeIcon");

/* ------------------------------------------------------ objects, sources */

export const FolderIcon = glyph(PhFolder, "FolderIcon");
export const FolderOpenIcon = glyph(PhFolderOpen, "FolderOpenIcon");
export const FileIcon = glyph(PhFile, "FileIcon");
export const FilePdfIcon = glyph(PhFilePdf, "FilePdfIcon");
export const CloudIcon = glyph(PhCloud, "CloudIcon");
export const DriveIcon = glyph(GoogleDriveLogoIcon, "DriveIcon");
export const ImageIcon = glyph(PhImage, "ImageIcon");
export const DatabaseIcon = glyph(PhDatabase, "DatabaseIcon");
export const StackIcon = glyph(PhStack, "StackIcon");
export const TagIcon = glyph(PhTag, "TagIcon");
export const TreeIcon = glyph(PhTreeStructure, "TreeIcon");
export const TranslateIcon = glyph(PhTranslate, "TranslateIcon");
export const SparkIcon = glyph(SparkleIcon, "SparkIcon");
export const LightningIcon = glyph(PhLightning, "LightningIcon");

/* ------------------------------------------------------ people, account */

export const UserIcon = glyph(PhUser, "UserIcon");
export const UserCircleIcon = glyph(PhUserCircle, "UserCircleIcon");
export const EmailIcon = glyph(EnvelopeSimpleIcon, "EmailIcon");
export const KeyIcon = glyph(PhKey, "KeyIcon");
export const LockIcon = glyph(PhLock, "LockIcon");
export const ShieldCheckIcon = glyph(PhShieldCheck, "ShieldCheckIcon");
export const GlobeIcon = glyph(PhGlobe, "GlobeIcon");

/* -------------------------------------------------------------- theme */

export const SunIcon = glyph(PhSun, "SunIcon");
export const MoonIcon = glyph(PhMoon, "MoonIcon");
export const MonitorIcon = glyph(PhMonitor, "MonitorIcon");
export const ContrastIcon = glyph(CircleHalfIcon, "ContrastIcon");
export const PaletteIcon = glyph(PhPalette, "PaletteIcon");

/* ------------------------------------------------------------- status */

export const InfoIcon = glyph(PhInfo, "InfoIcon");
export const WarningIcon = glyph(PhWarning, "WarningIcon");
export const WarningCircleIcon = glyph(PhWarningCircle, "WarningCircleIcon");
export const QuestionIcon = glyph(PhQuestion, "QuestionIcon");
export const ClockIcon = glyph(PhClock, "ClockIcon");
export const HourglassIcon = glyph(PhHourglass, "HourglassIcon");

/** A spinner for the few places a skeleton cannot stand in (inside a button). */
export function SpinnerIcon({ className }: { className?: string }) {
  return (
    <CircleNotchIcon
      aria-hidden="true"
      focusable="false"
      weight="bold"
      className={`animate-spin motion-reduce:animate-none ${className ?? ""}`}
    />
  );
}

/* ------------------------------------------------------------ brand marks */

export function LogoMarkIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 64 64" fill="none" className={className}>
      <path fill="currentColor" d="M29.2 4.4 7.4 47 29.2 35.7V4.4Z" />
      <path fill="currentColor" d="M34.8 4.4 56.6 47 34.8 35.7V4.4Z" />
      <path fill="currentColor" d="m35.3 40.5 22.5 9.9-22.9 10.7-10-18.7 10.4-1.9Z" />
      <path fill="currentColor" d="m6.6 50.6 13.6-7.1 10.7 17.6L6.6 50.6Z" />
    </svg>
  );
}

/*
 * The provider marks below are drawn as filled logos in the providers' own
 * colours rather than the monochrome glyph set. They are third-party marks,
 * not Papertrend's, and Google's sign-in branding guidance asks for the
 * official mark on the one page where a reader decides whether to trust the
 * site with an account.
 */
export function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.54 5.54 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.87z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.94-2.91l-3.88-3.01c-1.08.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.94H1.28v3.1A12 12 0 0 0 12 24z"
      />
      <path fill="#FBBC05" d="M5.29 14.29a7.2 7.2 0 0 1 0-4.58v-3.1H1.28a12 12 0 0 0 0 10.78l4.01-3.1z" />
      <path
        fill="#EA4335"
        d="M12 4.75c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.61l4.01 3.1C6.23 6.86 8.88 4.75 12 4.75z"
      />
    </svg>
  );
}

export function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        fill="#1877F2"
        d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.96h-1.5c-1.48 0-1.94.92-1.94 1.87v2.24h3.3l-.53 3.49h-2.77V24C19.61 23.1 24 18.1 24 12.07z"
      />
    </svg>
  );
}

export function MicrosoftIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path fill="#F25022" d="M2 2h9.5v9.5H2z" />
      <path fill="#7FBA00" d="M12.5 2H22v9.5h-9.5z" />
      <path fill="#00A4EF" d="M2 12.5h9.5V22H2z" />
      <path fill="#FFB900" d="M12.5 12.5H22V22h-9.5z" />
    </svg>
  );
}

export function AppleIcon({ className }: { className?: string }) {
  return <AppleLogoIcon aria-hidden="true" focusable="false" weight="fill" className={className} />;
}
