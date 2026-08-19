'use client';
import { TransportBridge } from '@/lib/data/transport';
import { CatalogItem, fetchItemsPage } from '@/lib/parity/catalog';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  FilterBar,
  FilterField,
  FilterValue,
  IconButton,
  IconButtonLink,
  IndexTable,
  Page,
  Pagination,
  SortState,
} from '@flashmandu/app-bridge-ui/react';
import { useAppBridge } from '@flashmandu/app-bridge/react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

const IconExternal = () => (
  <svg
    xmlns='http://www.w3.org/2000/svg'
    fill='none'
    viewBox='0 0 24 24'
    strokeWidth={1.7}
    stroke='currentColor'>
    <path
      strokeLinecap='round'
      strokeLinejoin='round'
      d='M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-3-6 4.5 4.5M15 3h5.25A.75.75 0 0 1 21 3.75V9'
    />
  </svg>
);
const IconPencil = () => (
  <svg
    xmlns='http://www.w3.org/2000/svg'
    fill='none'
    viewBox='0 0 24 24'
    strokeWidth={1.7}
    stroke='currentColor'>
    <path
      strokeLinecap='round'
      strokeLinejoin='round'
      d='m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z'
    />
  </svg>
);
const IconTrash = () => (
  <svg
    xmlns='http://www.w3.org/2000/svg'
    fill='none'
    viewBox='0 0 24 24'
    strokeWidth={1.7}
    stroke='currentColor'>
    <path
      strokeLinecap='round'
      strokeLinejoin='round'
      d='m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166M19.206 5.79 18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79M4.77 5.79c.342-.059.683-.114 1.024-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916'
    />
  </svg>
);

const PAGE_SIZE = 10;
// How many items a single search "walk" fetches. Not full server pagination —
// see the hasMore notice rendered below when a walk is truncated.
const WALK_SIZE = 100;
const SEARCH_DEBOUNCE_MS = 300;

/** Maps a table column's sort key to the actual CatalogItem field it sorts by. */
const SORT_FIELD_MAP: Partial<Record<string, keyof CatalogItem>> = {
  name: 'name',
  price: 'priceMinor',
};

/**
 * The filter schema. `defaultValue` is what makes "All" produce no chip and
 * not count toward "Clear all" — the same rule the host applies to a select
 * sitting at its declared default. The key reads as a status, so the bar also
 * offers these options as one-click quick filters at the top of its menu.
 *
 * NOTE: the app-facing schema has no status field — this filters client-side
 * against `CatalogItem.isActive` (active = isActive, draft = !isActive), the
 * same stand-in `deriveCategories` uses for `activeCount`.
 */
const STATUS_FIELD: FilterField = {
  key: 'status',
  label: 'Status',
  type: 'select',
  defaultValue: '',
  options: [
    { label: 'All items', value: '' },
    { label: 'Active', value: 'active' },
    { label: 'InActive', value: 'inactive' },
  ],
};

const ItemsPage = () => {
  const bridgeState = useAppBridge();

  /**
   * The bridge object exists immediately (module singleton), but it is only
   * USABLE once the host has answered CONTEXT — that is what populates
   * `hostCapabilities.directApi`. Handing it over before then makes the first
   * read report "no transport" for a host that has one.
   */
  const bridge =
    bridgeState.status === 'ready' && bridgeState.embedded
      ? (bridgeState.bridge as unknown as TransportBridge)
      : null;
  const profileId =
    bridgeState.status === 'ready' ? bridgeState.profileId : null;

  const [items, setItems] = useState<CatalogItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState | null>({
    key: 'name',
    direction: 'asc',
  });
  const [selected, setSelected] = useState<Array<string | number>>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [sentTerm, setSentTerm] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [denial, setDenial] = useState<{
    title: string;
    detail: string;
  } | null>(null);

  const filterValues = useMemo<Record<string, FilterValue>>(
    () => ({ status }),
    [status],
  );

  // Debounce the raw search box into the term that actually gets sent.
  useEffect(() => {
    const handle = setTimeout(() => {
      setSentTerm(query);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    if (bridge === null) {
      return;
    }
    let cancelled = false;
    setBusy(true);
    void fetchItemsPage(bridge, { first: WALK_SIZE, query: sentTerm })
      .then((result) => {
        if (cancelled) {
          return;
        }
        setNote(result.meta.note);
        setHasMore(result.hasNextPage);
        if (result.error !== null) {
          setDenial({
            title:
              result.error.name === 'ScopeDeniedError'
                ? 'Read refused'
                : 'The read failed',
            detail: result.error.message,
          });
          setItems([]);
          return;
        }
        setDenial(null);
        setItems(result.items);
        setPage(1);
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        console.error('fetchItemsPage failed', err);
        setDenial({
          title: 'The read failed',
          detail: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        if (!cancelled) {
          setBusy(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [bridge, sentTerm]);

  /** Any filter change invalidates the page you were on, and the selection. */
  useEffect(() => {
    setPage(1);
    setSelected([]);
  }, [query, status]);

  // Status has no server field, so it's applied client-side over the walked batch.
  const filteredItems = useMemo(() => {
    if (status === '') return items;
    const wantActive = status === 'active';
    return items.filter((item) => item.isActive === wantActive);
  }, [items, status]);

  // Client-side sort over the filtered batch, using the real field name.
  const sortedItems = useMemo(() => {
    if (!sort) return filteredItems;
    const field = SORT_FIELD_MAP[sort.key] ?? (sort.key as keyof CatalogItem);
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...filteredItems].sort((a, b) => {
      const av = a[field];
      const bv = b[field];
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      return av > bv ? factor : -factor;
    });
  }, [filteredItems, sort]);

  const totalPages = Math.max(1, Math.ceil(sortedItems.length / PAGE_SIZE));
  const pageItems = sortedItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <Page
      title='Test'
      subtitle='Welcome to your AutoHisab Business app.'
      crumbs={[{ label: 'Dashboard', path: '/' }, { label: 'tests' }]}
      linkComponent={Link}
      actions={[
        {
          id: 'new-item',
          label: 'New item',
          variant: 'primary',
          onSelect: () => {
            window.location.href = '/items';
          },
        },
      ]}>
      {denial !== null && (
        <Alert
          variant='danger'
          title={denial.title}>
          {denial.detail}
        </Alert>
      )}
      {denial === null && note !== null && <Alert variant='info'>{note}</Alert>}
      {denial === null && hasMore && (
        <Alert variant='warning'>
          Showing the first {WALK_SIZE} matching items. Refine your search to
          narrow the results.
        </Alert>
      )}
      <FilterBar
        search={{
          value: query,
          onChange: setQuery,
          placeholder: 'Search items...',
        }}
        fields={[STATUS_FIELD]}
        values={filterValues}
        onChange={(key, value) => {
          if (key === 'status')
            setStatus(typeof value === 'string' ? value : '');
        }}
        onClear={() => {
          setQuery('');
          setStatus('');
        }}
        // The pin: "save this filter as my default for this list". Scope names
        // the list; profileId partitions it, so two merchants sharing a browser
        // do not inherit each other's view.
        defaults={{ scope: 'items', profileId }}
      />
      <IndexTable<CatalogItem>
        label='Items'
        columns={[
          // The first column is pinned: it stays put while the table travels
          // sideways on narrow viewports.
          {
            key: 'name',
            label: 'Name',
            sortable: true,
            pinned: true,
            render: (item) => item.name,
          },
          {
            key: 'sku',
            label: 'SKU',
            render: (item) => <code>{item.sku ?? '—'}</code>,
          },
          {
            key: 'status',
            label: 'Status',
            render: (item) => (
              <Badge tone={item.isActive ? 'success' : 'neutral'}>
                {item.isActive ? 'Active' : 'Inactive'}
              </Badge>
            ),
          },
          {
            key: 'price',
            label: 'Price',
            align: 'right',
            sortable: true,
            render: (item) => (item.priceMinor / 100).toFixed(2),
          },
        ]}
        data={pageItems}
        keyExtractor={(item) => item.id}
        sort={sort}
        onSortChange={setSort}
        selectable
        selected={selected}
        onSelectionChange={setSelected}
        bulkActions={[
          {
            key: 'archive',
            label: 'Archive',
            onAction: (ids) => console.log('archive', ids),
          },
        ]}
        rowActions={(item) => (
          <>
            <IconButtonLink
              variant='view'
              label='Open in storefront'
              href={`/storefront/items/${item.id}`}
              target='_blank'>
              <IconExternal />
            </IconButtonLink>
            <Link href={`/test/${item.id}`}>
              edit
              <IconPencil />
            </Link>
            <IconButton
              variant='delete'
              label='Delete'
              onClick={() => console.log('delete', item.id)}>
              <IconTrash />
            </IconButton>
          </>
        )}
        loading={busy}
        loadingRows={PAGE_SIZE}
        emptyState={
          query !== '' || status !== '' ? (
            <EmptyState
              title='No items match the current search and filters.'
              action={
                <Button
                  onClick={() => {
                    setQuery('');
                    setStatus('');
                  }}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              title='No items yet'
              description='Items you create will appear here.'
            />
          )
        }
        footer={
          <Pagination
            current={page}
            total={totalPages}
            onChange={setPage}
          />
        }
      />
    </Page>
  );
};

export default ItemsPage;
