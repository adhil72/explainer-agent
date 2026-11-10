import { icons, type LucideIcon } from 'lucide-react';

/** The icons the writer may use (lucide names, kebab-case). Short on purpose: the model picks well from a list it can read. */
export const ALLOWED_ICONS = `atom brain rocket globe earth sun moon star zap flame droplet leaf tree-pine mountain waves wind snowflake cloud
cloud-rain thermometer heart heart-pulse activity dna microscope flask-conical pill stethoscope bone eye ear hand footprints baby user
users crown trophy medal target crosshair flag map map-pin compass navigation plane car bus train-front ship bike fuel battery
battery-charging plug cpu smartphone laptop monitor wifi radio satellite antenna server database code bot shield shield-alert lock key
fingerprint bug skull alert-triangle ban check-circle x-circle help-circle info lightbulb sparkles wand-sparkles magnet gauge timer
clock hourglass calendar history trending-up trending-down chart-line chart-bar chart-pie dollar-sign coins wallet credit-card banknote
piggy-bank landmark building building-2 factory home store shopping-cart package truck scale gavel book book-open graduation-cap school
pencil newspaper megaphone message-circle mail phone camera film music headphones gamepad-2 palette brush scissors hammer wrench
settings infinity repeat refresh-cw arrow-right arrow-up arrow-down link puzzle layers box boxes recycle trash-2 apple fish bird cat
dog rabbit egg wheat coffee utensils pizza swords bomb handshake gem diamond orbit telescope rainbow tornado eye-off search percent
hash sigma ruler binary bitcoin ghost party-popper smile frown thumbs-up thumbs-down`.split(/\s+/);

const pascal = (s: string) => s.split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : '')).join('');

/** The icon component for a name, or null when it does not exist. */
export function iconFor(name?: string): LucideIcon | null {
  if (!name) return null;
  return (icons as Record<string, LucideIcon>)[pascal(name.trim().toLowerCase())] ?? null;
}
