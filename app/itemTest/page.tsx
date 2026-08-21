"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Badge,
  Button,
  EmptyState,
  FilterBar,
  IndexTable,
  Page,
  Pagination,
  type FilterField,
  type FilterValue,
  type SortState,
} from "@flashmandu/app-bridge-ui/react";
import { getBridge, useProfileId } from "@flashmandu/app-bridge/react";
import { useGraphQL } from "@/hooks/useGraphQL";
import { ItemsQuery, type Item } from "@/lib/graphql/operations/items";

const FETCH_SIZE = 50;
const PAGE_SIZE = 10;

const STATUS_FIELD: FilterField = {
  key: "isActive",
  label: "Status",
  type: "select",
  defaultValue: "",
  options: [
    {
      label: "All items",
      value: "",
    },
    {
      label: "Active",
      value: "true",
    },
    {
      label: "Inactive",
      value: "false",
    },
  ],
};

export default function ItemsPage() {
  const bridge = getBridge();

  const bridgeStatus = useProfileId();

  const profileId =
    bridgeStatus.status === "ready" ? bridgeStatus.profileId : undefined;

  const [allItems, setAllItems] = useState<Item[]>([]);

  /**
   * Cursor used only for fetching the next batch from GraphQL.
   */
  const [fetchCursor, setFetchCursor] = useState<string | null>(null);

  /**
   * Used to force the next 100-item request.
   */
  const [fetchRequest, setFetchRequest] = useState(0);

  const [loadingAllItems, setLoadingAllItems] = useState(true);

  const [query, setQuery] = useState("");

  const [isActive, setIsActive] = useState("");

  const [page, setPage] = useState(1);

  const [sort, setSort] = useState<SortState | null>({
    key: "name",
    direction: "asc",
  });

  const [selected, setSelected] = useState<Array<string | number>>([]);

  const filterValues = useMemo<Record<string, FilterValue>>(
    () => ({
      isActive,
    }),
    [isActive],
  );

  /**
   * Always fetch 100 items.
   *
   * First request:
   *   first: 100
   *   after: null
   *
   * Next request:
   *   first: 100
   *   after: previous endCursor
   */
  const { data, loading, error } = useGraphQL(bridge, ItemsQuery, {
    first: FETCH_SIZE,
    after: fetchCursor,
  });

  /**
   * Process each 100-item response.
   */
  useEffect(() => {
    if (!data) {
      return;
    }

    const newItems = data.items.nodes;

    setAllItems((previous) => {
      const existingIds = new Set(previous.map((item) => item.id));

      const uniqueNewItems = newItems.filter(
        (item) => !existingIds.has(item.id),
      );

      return [...previous, ...uniqueNewItems];
    });

    if (data.items.pageInfo.hasNextPage) {
      /**
       * Fetch another 100.
       */
      setFetchCursor(data.items.pageInfo.endCursor);
      setFetchRequest((value) => value + 1);
    } else {
      /**
       * Everything has now been fetched.
       */
      setLoadingAllItems(false);
    }
  }, [data]);

  /**
   * Backend has finished fetching all records.
   */
  const isLoading = loading || loadingAllItems;

  /**
   * Client-side search and isActive filtering.
   */
  const filteredItems = useMemo(() => {
    let result = [...allItems];

    const search = query.trim().toLowerCase();

    if (search) {
      result = result.filter((item) => {
        return (
          item.name.toLowerCase().includes(search) ||
          item.sku.toLowerCase().includes(search)
        );
      });
    }

    if (isActive === "true") {
      result = result.filter((item) => item.isActive === true);
    }

    if (isActive === "false") {
      result = result.filter((item) => item.isActive === false);
    }

    return result;
  }, [allItems, query, isActive]);

  /**
   * Client-side sorting.
   */
  const sortedItems = useMemo(() => {
    if (!sort) {
      return filteredItems;
    }

    const result = [...filteredItems];

    result.sort((a, b) => {
      let aValue: string | number | boolean;
      let bValue: string | number | boolean;

      switch (sort.key) {
        case "name":
          aValue = a.name;
          bValue = b.name;
          break;

        case "sku":
          aValue = a.sku;
          bValue = b.sku;
          break;

        case "priceMinor":
          aValue = a.priceMinor;
          bValue = b.priceMinor;
          break;

        case "isActive":
          aValue = a.isActive;
          bValue = b.isActive;
          break;

        case "categoryId":
          aValue = a.categoryId ?? "";
          bValue = b.categoryId ?? "";
          break;

        default:
          return 0;
      }

      if (typeof aValue === "string" && typeof bValue === "string") {
        const comparison = aValue.localeCompare(bValue, undefined, {
          sensitivity: "base",
        });

        return sort.direction === "asc" ? comparison : -comparison;
      }

      if (aValue < bValue) {
        return sort.direction === "asc" ? -1 : 1;
      }

      if (aValue > bValue) {
        return sort.direction === "asc" ? 1 : -1;
      }

      return 0;
    });

    return result;
  }, [filteredItems, sort]);

  /**
   * Frontend pagination.
   */
  const totalItems = sortedItems.length;

  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));

  const paginatedItems = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;

    return sortedItems.slice(start, start + PAGE_SIZE);
  }, [sortedItems, page]);

  /**
   * Search/filter changes reset UI pagination.
   */
  useEffect(() => {
    setPage(1);
    setSelected([]);
  }, [query, isActive]);

  /**
   * Prevent the current page from becoming invalid
   * after filtering.
   */
  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const handlePageChange = (nextPage: number) => {
    if (nextPage < 1 || nextPage > totalPages) {
      return;
    }

    setPage(nextPage);
    setSelected([]);
  };

  return (
    <Page
      title="Items"
      crumbs={[
        {
          label: "Dashboard",
          path: "/",
        },
        {
          label: "Items",
        },
      ]}
      linkComponent={Link}
    >
      <div className="fm-page-actions">
        <Button variant="primary" onClick={() => undefined}>
          New item
        </Button>
      </div>

      <FilterBar
        search={{
          value: query,
          onChange: setQuery,
          placeholder: "Search items...",
        }}
        fields={[STATUS_FIELD]}
        values={filterValues}
        onChange={(key, value) => {
          if (key === "isActive") {
            setIsActive(typeof value === "string" ? value : "");
          }
        }}
        onClear={() => {
          setQuery("");
          setIsActive("");
        }}
        defaults={{
          scope: "items",
          profileId,
        }}
      />

      {error && <Badge tone="danger">{error.message}</Badge>}

      <IndexTable<Item>
        label="Items"
        columns={[
          {
            key: "name",
            label: "Name",
            sortable: true,
            pinned: true,
            render: (item) => item.name,
          },
          {
            key: "sku",
            label: "SKU",
            render: (item) => <code>{item.sku}</code>,
          },
          {
            key: "priceMinor",
            label: "Price",
            align: "right",
            sortable: true,
            render: (item) => item.priceMinor,
          },
          {
            key: "isActive",
            label: "Status",
            sortable: true,
            render: (item) => (
              <Badge tone={item.isActive ? "success" : "neutral"}>
                {item.isActive ? "Active" : "Inactive"}
              </Badge>
            ),
          },
          {
            key: "categoryId",
            label: "Category",
            render: (item) => item.categoryId || "—",
          },
          {
            key: "imageUrl",
            label: "Image",
            render: (item) =>
              item.imageUrl ? (
                <img
                  src={item.imageUrl}
                  alt={item.name}
                  width={40}
                  height={40}
                  style={{
                    objectFit: "cover",
                    borderRadius: 4,
                  }}
                />
              ) : (
                "—"
              ),
          },
        ]}
        data={paginatedItems}
        keyExtractor={(item) => item.id}
        sort={sort}
        onSortChange={setSort}
        selectable
        selected={selected}
        onSelectionChange={setSelected}
        bulkActions={[
          {
            key: "archive",
            label: "Archive",
            onAction: (ids) => console.log("archive", ids),
          },
        ]}
        loading={isLoading}
        loadingRows={PAGE_SIZE}
        emptyState={
          query !== "" || isActive !== "" ? (
            <EmptyState
              title="No items match the current search and filters."
              action={
                <Button
                  onClick={() => {
                    setQuery("");
                    setIsActive("");
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="No items yet"
              description="Items you create will appear here."
            />
          )
        }
        footer={
          <Pagination
            current={page}
            total={totalPages}
            onChange={handlePageChange}
            siblingCount={6}
          />
        }
      />
    </Page>
  );
}
