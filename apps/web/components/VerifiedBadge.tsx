const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

interface VerifiedBadgeProps {
  size?: number;
  style?: React.CSSProperties;
}

/** Кастомная галочка верификации (загруженная Pixset Studio), используется везде вместо emoji ✔. */
export function VerifiedBadge({ size = 16, style }: VerifiedBadgeProps) {
  return (
    <img
      src={`${BASE_PATH}/badges/verified.png`}
      alt="Верифицирован"
      title="Верифицирован"
      width={size}
      height={size}
      style={{ display: 'inline-block', verticalAlign: 'middle', marginLeft: 4, ...style }}
    />
  );
}
