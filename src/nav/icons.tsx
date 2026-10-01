/**
 * Puente entre los nombres de ícono declarados en `modulos.ts` y los
 * componentes de `lucide-react`.
 *
 * Existe para que la capa de navegación siga siendo datos puros testeables en
 * `environment: node`, sin arrastrar React a los tests de configuración.
 */
import {
  LayoutDashboard, DollarSign, Egg, Settings, Mail, PackageOpen, Truck, Users,
  ClipboardList, CreditCard, Tag, FileText, BarChart3, TrendingUp, Receipt,
  CreditCard as CreditCardAlt, Scale, PiggyBank,
  type LucideIcon,
} from 'lucide-react';
import type { IconName } from './modulos';

const ICONOS: Record<IconName, LucideIcon> = {
  LayoutDashboard,
  DollarSign,
  Egg,
  Settings,
  Mail,
  PackageOpen,
  Truck,
  Users,
  ClipboardList,
  CreditCard,
  Tag,
  FileText,
  BarChart3,
  TrendingUp,
  Receipt,
  CreditCardAlt,
  Scale,
  PiggyBank,
};

export const iconoDe = (nombre: IconName): LucideIcon => {
  const Ico = ICONOS[nombre];
  if (!Ico) throw new Error(`Ícono de navegación no registrado: "${nombre}"`);
  return Ico;
};
