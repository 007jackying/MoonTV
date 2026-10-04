'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

interface NavigationLoadingContextType {
  isLoading: boolean;
  startLoading: () => void;
}

const NavigationLoadingContext = createContext<NavigationLoadingContextType>({
  isLoading: false,
  startLoading: () => undefined,
});

export const useNavigationLoading = () => useContext(NavigationLoadingContext);

export function NavigationLoadingProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const fallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 兜底：如果地址没有变化（如 Ctrl+点击在新标签页打开），8 秒后自动结束
  const startLoading = useCallback(() => {
    setIsLoading(true);
    if (fallbackRef.current) clearTimeout(fallbackRef.current);
    fallbackRef.current = setTimeout(() => setIsLoading(false), 8000);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false);
      if (fallbackRef.current) clearTimeout(fallbackRef.current);
    }, 150);
    return () => clearTimeout(timer);
  }, [pathname, searchParams]);

  return (
    <NavigationLoadingContext.Provider value={{ isLoading, startLoading }}>
      {children}
    </NavigationLoadingContext.Provider>
  );
}
