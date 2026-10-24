import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';

/** Hugeicons Free 的单色包装：颜色跟随 currentColor，避免双色图标抢视觉。 */
export function HugeIcon({
  icon,
  size = 16,
  className,
}: {
  icon: IconSvgElement;
  size?: number;
  className?: string;
}): JSX.Element {
  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      className={className}
      color="currentColor"
      primaryColor="currentColor"
      secondaryColor="currentColor"
      disableSecondaryOpacity
      aria-hidden="true"
    />
  );
}
