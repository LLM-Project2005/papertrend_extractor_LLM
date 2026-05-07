interface IconProps {
  className?: string;
}

function BaseIcon({
  className,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}

export function LogoMarkIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M6 6h12v12H6z" />
      <path d="M9 9h6v6H9z" />
      <path d="M6 12h3" />
      <path d="M15 12h3" />
    </BaseIcon>
  );
}

export function HomeIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6.5 9.5V20h11V9.5" />
    </BaseIcon>
  );
}

export function ChartIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M4 19h16" />
      <path d="M7 16V9" />
      <path d="M12 16V5" />
      <path d="M17 16v-7" />
    </BaseIcon>
  );
}

export function ChatIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M5 6.5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H10l-5 4v-4H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z" />
    </BaseIcon>
  );
}

export function PaperIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M8 3.5h6l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 7 20V5A1.5 1.5 0 0 1 8.5 3.5Z" />
      <path d="M14 3.5V8h4" />
      <path d="M10 12h4" />
      <path d="M10 15h4" />
    </BaseIcon>
  );
}

export function UploadIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M12 16V4" />
      <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
      <path d="M5 19.5h14" />
    </BaseIcon>
  );
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M12 8.5A3.5 3.5 0 1 1 8.5 12 3.5 3.5 0 0 1 12 8.5Z" />
      <path d="M19 12a7.1 7.1 0 0 0-.1-1l2.1-1.6-2-3.4-2.5 1a7.8 7.8 0 0 0-1.8-1L14.2 3h-4.4l-.5 3a7.8 7.8 0 0 0-1.8 1l-2.5-1-2 3.4L5.1 11A7.1 7.1 0 0 0 5 12c0 .3 0 .7.1 1l-2.1 1.6 2 3.4 2.5-1a7.8 7.8 0 0 0 1.8 1l.5 3h4.4l.5-3a7.8 7.8 0 0 0 1.8-1l2.5 1 2-3.4-2.1-1.6c.1-.3.1-.7.1-1Z" />
    </BaseIcon>
  );
}

export function ArrowRightIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </BaseIcon>
  );
}

export function PlusIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </BaseIcon>
  );
}

export function SendIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="m21 3-9.5 9.5" />
      <path d="M21 3 14 21l-2.8-7.2L4 11l17-8Z" />
    </BaseIcon>
  );
}

export function SparkIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M12 3.5 13.7 8l4.8 1.7-4.8 1.8-1.7 4.5-1.7-4.5L5.5 9.7 10.3 8 12 3.5Z" />
    </BaseIcon>
  );
}

export function MenuIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </BaseIcon>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="m6 6 12 12" />
      <path d="M18 6 6 18" />
    </BaseIcon>
  );
}

export function SunIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.2" />
      <path d="M12 19.3v2.2" />
      <path d="m4.9 4.9 1.6 1.6" />
      <path d="m17.5 17.5 1.6 1.6" />
      <path d="M2.5 12h2.2" />
      <path d="M19.3 12h2.2" />
      <path d="m4.9 19.1 1.6-1.6" />
      <path d="m17.5 6.5 1.6-1.6" />
    </BaseIcon>
  );
}

export function MoonIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M20 14.2A7.8 7.8 0 0 1 9.8 4a8.5 8.5 0 1 0 10.1 10.2Z" />
    </BaseIcon>
  );
}

export function FilterIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M4 6h16" />
      <path d="M7 12h10" />
      <path d="M10 18h4" />
    </BaseIcon>
  );
}

export function EqualizerIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M6 5.5v13" />
      <path d="M12 5.5v13" />
      <path d="M18 5.5v13" />
      <circle cx="6" cy="9" r="1.6" />
      <circle cx="12" cy="14" r="1.6" />
      <circle cx="18" cy="10.5" r="1.6" />
    </BaseIcon>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </BaseIcon>
  );
}

export function CheckCircleIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9Z" />
      <path d="m8.5 12 2.3 2.3 4.7-4.8" />
    </BaseIcon>
  );
}

export function CircleIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <circle cx="12" cy="12" r="8" />
    </BaseIcon>
  );
}

export function UserIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 19a7 7 0 0 1 14 0" />
    </BaseIcon>
  );
}

export function LogoutIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M10 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19H10" />
      <path d="M14 8.5 19 12l-5 3.5" />
      <path d="M19 12H9" />
    </BaseIcon>
  );
}

export function EmailIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="m5 7 7 6 7-6" />
    </BaseIcon>
  );
}

export function MicrosoftIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <rect x="4.5" y="4.5" width="6" height="6" />
      <rect x="13.5" y="4.5" width="6" height="6" />
      <rect x="4.5" y="13.5" width="6" height="6" />
      <rect x="13.5" y="13.5" width="6" height="6" />
    </BaseIcon>
  );
}

export function GoogleIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M19.2 12.2c0-.6-.1-1.1-.2-1.6H12v3.1h4.1a4.2 4.2 0 0 1-1.8 2.8" />
      <path d="M14.3 16.5a7 7 0 0 1-2.3.4A6.9 6.9 0 0 1 5.5 12a6.9 6.9 0 0 1 6.5-4.9 6.7 6.7 0 0 1 4.6 1.8" />
      <path d="M4.8 8.8a7.3 7.3 0 0 0 0 6.4" />
      <path d="M14.3 16.5 18 19" />
    </BaseIcon>
  );
}

export function FacebookIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M13.5 20v-6.5H16l.5-3h-3V8.8c0-.9.3-1.5 1.6-1.5h1.6V4.7c-.3 0-1.1-.2-2.1-.2-2.1 0-3.6 1.3-3.6 3.8v2.2H8.5v3h2.5V20" />
    </BaseIcon>
  );
}

export function AppleIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M14 5.5c.7-.8 1.1-1.9 1-3-.9.1-2 .6-2.7 1.4-.6.7-1.1 1.8-1 2.9 1 0 2-.5 2.7-1.3Z" />
      <path d="M12.2 8.4c-1.5 0-2.2.9-3.3.9-1.1 0-1.4-.8-3-.8-2 0-4.1 1.7-4.1 5 .1 2.4 1 4.8 2.5 6.7.8 1 1.8 2.2 3.1 2.1 1.2-.1 1.7-.8 3.2-.8s1.9.8 3.3.8c1.4 0 2.2-1.1 3-2.1.6-.8 1.2-1.8 1.6-2.8-2.4-.9-3.5-4-1.7-6 .8-.9 1.8-1.4 2.8-1.5-.7-1-1.9-2.5-3.9-2.5-1.3 0-2.3.9-3.5.9Z" />
    </BaseIcon>
  );
}

export function FolderIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4l1.5 2h8.5A1.5 1.5 0 0 1 20.5 9.5v8A1.5 1.5 0 0 1 19 19H5A1.5 1.5 0 0 1 3.5 17.5Z" />
    </BaseIcon>
  );
}

export function FileIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M8 3.5h6l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 7 20V5A1.5 1.5 0 0 1 8.5 3.5Z" />
      <path d="M14 3.5V8h4" />
    </BaseIcon>
  );
}

export function CloudIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M8.5 18.5h9a3.5 3.5 0 0 0 .5-7 5 5 0 0 0-9.5-1.5A3.8 3.8 0 0 0 8.5 18.5Z" />
    </BaseIcon>
  );
}

export function DriveIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="m9 4 4 7-4 7H5l4-7-4-7Z" />
      <path d="m9 4 4 7h6l-4-7Z" />
      <path d="m13 11-4 7h6l4-7Z" />
    </BaseIcon>
  );
}

export function OneDriveIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M7.5 18.5h9.8a3.2 3.2 0 0 0 .2-6.4 4.6 4.6 0 0 0-8.4-1.7A3.9 3.9 0 0 0 7.5 18.5Z" />
      <path d="M6.8 12.4a2.8 2.8 0 0 0-2.8 2.8 3.2 3.2 0 0 0 3.2 3.3h1.3" />
    </BaseIcon>
  );
}

export function SharePointIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <circle cx="8" cy="12" r="3.5" />
      <circle cx="16.5" cy="8.5" r="2.5" />
      <circle cx="17" cy="16.5" r="2.5" />
      <path d="M11 10.5 14.2 9" />
      <path d="M11 13.5 14.5 15" />
    </BaseIcon>
  );
}

export function CopyIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <rect x="9" y="9" width="10.5" height="10.5" rx="2" />
      <path d="M15 9V7a2 2 0 0 0-2-2H6.5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2H9" />
    </BaseIcon>
  );
}

export function RefreshIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </BaseIcon>
  );
}

export function AttachmentIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="m8.5 12.5 5.7-5.7a3 3 0 1 1 4.3 4.2l-7.4 7.5a5 5 0 1 1-7.1-7.1l7.3-7.4" />
    </BaseIcon>
  );
}

export function ChevronDownIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="m6 9 6 6 6-6" />
    </BaseIcon>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="m5 12 4.2 4.2L19 6.5" />
    </BaseIcon>
  );
}

export function DownloadIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M12 4.5v10" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M5 18.5h14" />
    </BaseIcon>
  );
}

export function StarIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="m12 4.5 2.3 4.8 5.2.7-3.8 3.8.9 5.2-4.6-2.5-4.6 2.5.9-5.2-3.8-3.8 5.2-.7Z" />
    </BaseIcon>
  );
}

export function ListViewIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M8 7h11" />
      <path d="M8 12h11" />
      <path d="M8 17h11" />
      <path d="M4.5 7h.01" />
      <path d="M4.5 12h.01" />
      <path d="M4.5 17h.01" />
    </BaseIcon>
  );
}

export function GridViewIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <rect x="4.5" y="4.5" width="6" height="6" rx="1.2" />
      <rect x="13.5" y="4.5" width="6" height="6" rx="1.2" />
      <rect x="4.5" y="13.5" width="6" height="6" rx="1.2" />
      <rect x="13.5" y="13.5" width="6" height="6" rx="1.2" />
    </BaseIcon>
  );
}

export function SortIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M5 7h11" />
      <path d="M5 12h8" />
      <path d="M5 17h5" />
      <path d="m17 7 2 2 2-2" />
      <path d="M19 9v8" />
    </BaseIcon>
  );
}

export function ImageIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="m6.5 16 3.5-3.5 2.8 2.8 2-2 2.7 2.7" />
    </BaseIcon>
  );
}

export function MoreHorizontalIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <circle cx="6" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </BaseIcon>
  );
}

export function PencilSquareIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M4.5 6.5A2 2 0 0 1 6.5 4.5h7" />
      <path d="M4.5 9.5v8a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-7" />
      <path d="m13.5 5.5 5 5" />
      <path d="m11.5 17.5 1-4 7-7a1.4 1.4 0 0 0-2-2l-7 7-4 1Z" />
    </BaseIcon>
  );
}

export function TrashIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M4.5 7.5h15" />
      <path d="M9 7.5v-2h6v2" />
      <path d="M7.5 7.5 8.3 19a1.5 1.5 0 0 0 1.5 1.4h4.4a1.5 1.5 0 0 0 1.5-1.4l.8-11.5" />
      <path d="M10 11v5.5" />
      <path d="M14 11v5.5" />
    </BaseIcon>
  );
}

export function PinIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="m14 4 6 6" />
      <path d="m16 9-5 5" />
      <path d="M8 6.5 17.5 16" />
      <path d="m10 14-6 6" />
      <path d="m6.5 8 9.5 9.5" />
    </BaseIcon>
  );
}

export function StopIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <rect x="7" y="7" width="10" height="10" rx="1.8" />
    </BaseIcon>
  );
}
