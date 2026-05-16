import type { RobotDefinition } from '../robots';

export function populateRobotSelector(
  selector: HTMLSelectElement,
  robots: RobotDefinition[],
  activeRobot: RobotDefinition,
  onSelect: (robotId: string) => void,
) {
  selector.replaceChildren(
    ...robots.map(robotDefinition => {
      const option = document.createElement('option');
      option.value = robotDefinition.id;
      option.textContent = robotDefinition.shortName;
      return option;
    }),
  );
  selector.value = activeRobot.id;
  selector.addEventListener('change', () => onSelect(selector.value));
}
