import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Button } from "../ui/Button";

export const ThemeToggle = () => {
  const [theme, setTheme] = useState(() => {
    // Check for saved user preference
    if (typeof window !== "undefined") {
      return localStorage.getItem("theme") || "light";
    }
    return "light";
  });

  useEffect(() => {
    // Apply the theme by toggling the 'dark' class on the <html> element
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    // Save the user's preference
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    const newTheme = theme === "light" ? "dark" : "light";
    setTheme(newTheme);
    toast.success(`Theme: ${newTheme}`);
  };

  return (
    <Button
      onClick={toggleTheme}
      className="px-4 py-2 bg-gray-200 dark:bg-primary-700 text-black dark:text-white responsive-text"
    >
      Toggle Theme
    </Button>
  );
};
