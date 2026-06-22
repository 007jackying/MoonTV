'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

interface NavigationLoadingContextType {
  isLoading: boolean;
  startLoading: () => void;
}

const NavigationLoadingContext = createContext<NavigationLoadingContextType>({
  isLoading: false,
  startLoading: () => {},
});

export const useNavigationLoading = () => useContext(NavigationLoadingContext);

export function NavigationLoadingProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const startLoading = useCallback(() => {
    setIsLoading(true);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 300);
    return () => clearTimeout(timer);
  }, [pathname, searchParams]);

  return (
    <NavigationLoadingContext.Provider value={{ isLoading, startLoading }}>
      {children}
    </NavigationLoadingContext.Provider>
  );
}
