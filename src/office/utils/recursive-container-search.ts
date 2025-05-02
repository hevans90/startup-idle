import { Container } from "pixi.js";

export function findChildrenByName({
  container,
  labelSubstring,
}: {
  container: Container;
  labelSubstring: string;
}): Container[] {
  const matches: Container[] = [];

  // Check if the container has any children
  if (container.children.length === 0) {
    return matches;
  }

  // Iterate through the children
  for (let i = 0; i < container.children.length; i++) {
    const child = container.children[i];

    // Check if the child's name contains the substring
    if (child.label && child.label.includes(labelSubstring)) {
      matches.push(child);
    }

    // If the child is a container, recursively search its children
    if (child instanceof Container) {
      const foundInChildren = findChildrenByName({
        container: child,
        labelSubstring,
      });
      matches.push(...foundInChildren); // Concatenate arrays
    }
  }

  // Return the array of matches
  return matches;
}
