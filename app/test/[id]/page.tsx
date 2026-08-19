'use client';

import ViewItemDetails from '@/components/ViewItemDetails';
import { Page } from '@flashmandu/app-bridge-ui/react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

export default function ItemDetailsPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();

  console.log('id', id);

  return (
    <Page
      title='Test ID'
      subtitle='Welcome to your AutoHisab Business app.'
      crumbs={[
        { label: 'Dashboard', path: '/' },
        { label: 'tests', path: '/test' },
        { label: `Test ${id}` },
      ]}
      linkComponent={Link}
      actions={[
        {
          id: 'new-item',
          label: 'New item',
          variant: 'primary',
          onSelect: () => {
            router.push('/items');
          },
        },
      ]}>
      <ViewItemDetails id={id} />
    </Page>
  );
}
