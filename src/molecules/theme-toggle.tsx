import { useThemeStore } from "../state/theme.store";
import { Button } from "../ui/Button";

export const ThemeToggle = () => {
  const { toggleTheme } = useThemeStore();
  return (
    <Button
      onClick={toggleTheme}
      className="px-4 py-2 bg-gray-200 dark:bg-primary-700 text-black dark:text-white responsive-text"
    >
      Toggle Theme
    </Button>
  );
};
