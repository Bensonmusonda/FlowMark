import {
  BookOpen,
  Bot,
  Brain,
  CalendarDays,
  CodeXml,
  File,
  FolderRoot,
  GitBranch,
  Layers,
  ListTree,
  MessageSquare,
  Network,
  PanelLeft,
  PanelRight,
  Puzzle,
  Search,
  Settings,
  Tags,
} from 'lucide';

const PANEL_ICONS = {
  'book-open': BookOpen,
  bot: Bot,
  brain: Brain,
  'calendar-days': CalendarDays,
  'code-xml': CodeXml,
  file: File,
  'folder-root': FolderRoot,
  'git-branch': GitBranch,
  layers: Layers,
  'list-tree': ListTree,
  'message-square': MessageSquare,
  network: Network,
  'panel-left': PanelLeft,
  'panel-right': PanelRight,
  puzzle: Puzzle,
  search: Search,
  settings: Settings,
  tags: Tags,
};

export function resolvePluginPanelIcon(name, fallback = PanelRight) {
  return Object.prototype.hasOwnProperty.call(PANEL_ICONS, name)
    ? PANEL_ICONS[name]
    : fallback;
}
