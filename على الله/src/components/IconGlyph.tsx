import {
  Award,
  BarChart3,
  Bell,
  BookMarked,
  BookOpen,
  Calculator,
  Calendar,
  ClipboardCheck,
  Compass,
  FileText,
  FlaskConical,
  GraduationCap,
  Layers,
  PlayCircle,
  ShieldCheck,
  Timer,
  Wrench,
} from 'lucide-react';

interface IconGlyphProps {
  name: string;
  className?: string;
}

export function IconGlyph({ name, className = 'w-4 h-4' }: IconGlyphProps) {
  switch (name) {
    case 'Compass':
      return <Compass className={className} />;
    case 'BarChart3':
      return <BarChart3 className={className} />;
    case 'BookOpen':
      return <BookOpen className={className} />;
    case 'PlayCircle':
      return <PlayCircle className={className} />;
    case 'FileText':
      return <FileText className={className} />;
    case 'ClipboardCheck':
      return <ClipboardCheck className={className} />;
    case 'Wrench':
      return <Wrench className={className} />;
    case 'Bell':
      return <Bell className={className} />;
    case 'Calendar':
      return <Calendar className={className} />;
    case 'Calculator':
      return <Calculator className={className} />;
    case 'FlaskConical':
      return <FlaskConical className={className} />;
    case 'Timer':
      return <Timer className={className} />;
    case 'BookMarked':
      return <BookMarked className={className} />;
    case 'GraduationCap':
      return <GraduationCap className={className} />;
    case 'ShieldCheck':
      return <ShieldCheck className={className} />;
    case 'Layers':
      return <Layers className={className} />;
    case 'Award':
      return <Award className={className} />;
    default:
      return <BookOpen className={className} />;
  }
}
