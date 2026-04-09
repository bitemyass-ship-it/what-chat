interface TrashIconProps {
  className?: string;
}

export default function TrashIcon({ className }: TrashIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M4 7h16" />
      <path d="M9 7V5.75A1.75 1.75 0 0 1 10.75 4h2.5A1.75 1.75 0 0 1 15 5.75V7" />
      <path d="M6.5 7l.7 11.1A2 2 0 0 0 9.2 20h5.6a2 2 0 0 0 2-1.9L17.5 7" />
      <path d="M10 11.25v5.5" />
      <path d="M14 11.25v5.5" />
    </svg>
  );
}
