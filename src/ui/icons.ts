import {
  Camera,
  CircleStop,
  Crosshair,
  FoldHorizontal,
  Grip,
  Home,
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
  Camera,
  CircleStop,
  Crosshair,
  FoldHorizontal,
  Grip,
  Home,
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
