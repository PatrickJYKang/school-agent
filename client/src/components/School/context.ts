import { createContext } from 'react';

export const SchoolNavigationContext = createContext<{
  openNewChat: () => void;
  href: string;
} | null>(null);
