import {
  Activity,
  Camera,
  CircleStop,
  Crosshair,
  FoldHorizontal,
  Grip,
  Home,
  Layers,
  Pause,
  Play,
  Route,
  RotateCcw,
  Send,
  Target,
  UnfoldHorizontal,
  createIcons,
} from 'lucide';

const icons = {
  Activity,
  Camera,
  CircleStop,
  Crosshair,
  FoldHorizontal,
  Grip,
  Home,
  Layers,
  Play,
  Pause,
  Route,
  RotateCcw,
  Send,
  Target,
  UnfoldHorizontal,
};

export function renderIcons() {
  createIcons({ icons });
}

export function updatePlayIcon(isPlaying: boolean) {
  const icon = document.querySelector<HTMLButtonElement>('#play-button i');
  if (!icon) {
    return;
  }
  icon.setAttribute('data-lucide', isPlaying ? 'pause' : 'play');
  renderIcons();
}
