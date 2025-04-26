import React from "react";

const colors = [
  "text-red-700 dark:text-red-500",
  "text-orange-700 dark:text-orange-500",
  "text-yellow-700 dark:text-yellow-500",
  "text-green-700 dark:text-green-500",
  "text-blue-700 dark:text-blue-500",
  "text-indigo-700 dark:text-indigo-500",
  "text-purple-700 dark:text-purple-500",
];

interface RainbowTextProps {
  text: string;
  className?: string;
}

export const RainbowText: React.FC<RainbowTextProps> = ({
  text,
  className = "",
}) => {
  let colorIndex = 0;

  return (
    <div className={`flex flex-wrap ${className}`}>
      {text.split("").map((char, i) => {
        if (char === " ") {
          return (
            <span key={i} className="whitespace-pre">
              {char}
            </span>
          );
        } else {
          const coloredChar = (
            <span key={i} className={`${colors[colorIndex % colors.length]}`}>
              {char}
            </span>
          );
          colorIndex++;
          return coloredChar;
        }
      })}
    </div>
  );
};
