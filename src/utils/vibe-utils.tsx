import React from "react";

const colors = [
  "text-red-600",
  "text-orange-600",
  "text-yellow-600",
  "text-green-600",
  "text-blue-600",
  "text-indigo-600",
  "text-purple-600",
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
