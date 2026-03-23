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
