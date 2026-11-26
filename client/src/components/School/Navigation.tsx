import { useCallback, useMemo } from 'react';
import { Button } from '@librechat/client';
import { Link, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useSchoolQuery } from '~/data-provider/School';
import { useLocalize, useAuthContext } from '~/hooks';
import { SchoolNavigationContext } from './context';

export function SchoolNavigation({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuthContext();
  const { data } = useSchoolQuery(isAuthenticated);
  const navigate = useNavigate();
  const openNewChat = useCallback(() => navigate('/school/new'), [navigate]);
  const value = useMemo(
    () => (data?.workspace?.enabled ? { openNewChat, href: '/school/new' } : null),
    [data?.workspace?.enabled, openNewChat],
  );
  return (
    <SchoolNavigationContext.Provider value={value}>{children}</SchoolNavigationContext.Provider>
  );
}

export function SchoolHomeLink() {
  const { data } = useSchoolQuery();
  const localize = useLocalize();
  if (!data?.workspace?.enabled) return null;
  return (
    <Button asChild variant="ghost" className="w-full justify-start">
      <Link to="/school">{localize('com_school_workspace')}</Link>
    </Button>
  );
}
