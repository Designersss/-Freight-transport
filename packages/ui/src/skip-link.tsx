interface SkipLinkProps {
  label: string;
}

export function SkipLink({ label }: SkipLinkProps) {
  return (
    <a className="movaro-skip" href="#main-content">
      {label}
    </a>
  );
}
