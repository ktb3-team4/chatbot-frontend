import { useRef, useEffect, useCallback } from "react";

/**
 * IntersectionObserver 기반 무한 스크롤 훅
 *
 * @param {Function} onLoadMore - 더 로드할 때 호출할 함수
 * @param {boolean} hasMore - 더 불러올 데이터가 있는지 여부
 * @param {boolean} isLoading - 현재 로딩 중인지 여부
 * @param {Object} options - IntersectionObserver 옵션 (rootRef 지원)
 * @returns {Object} { sentinelRef } - Sentinel 요소에 연결할 ref
 */
export const useInfiniteScroll = (
  onLoadMore,
  hasMore = true,
  isLoading = false,
  options = {}
) => {
  const { rootRef, ...restOptions } = options;
  const sentinelRef = useRef(null);
  const observerRef = useRef(null);

  const handleIntersect = useCallback(
    (entries) => {
      const [entry] = entries;

      if (entry.isIntersecting && hasMore && !isLoading) {
        onLoadMore();
      }
    },
    [onLoadMore, hasMore, isLoading]
  );

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) {
      return;
    }

    const rootElement = rootRef?.current || restOptions.root || null;

    // IntersectionObserver 옵션 설정
    const observerOptions = {
      // 스크롤 컨테이너를 root로 지정해 내부 스크롤에 반응
      root: rootElement, // viewport 기준 (기본값) 또는 전달된 컨테이너
      rootMargin: restOptions.rootMargin || "0px", // 200px 전에 미리 로드
      threshold: restOptions.threshold ?? 0.1, // 10% 이상 보이면 트리거
      ...restOptions,
    };

    // Observer 생성
    observerRef.current = new IntersectionObserver(
      handleIntersect,
      observerOptions
    );

    observerRef.current.observe(sentinel);

    return () => {
      if (observerRef.current && sentinel) {
        observerRef.current.unobserve(sentinel);
      }
    };
    // rootRef.current를 의존성에 포함해 컨테이너 ref가 설정된 이후에도 재관찰
  }, [
    hasMore,
    handleIntersect,
    rootRef?.current,
    restOptions.rootMargin,
    restOptions.threshold,
    restOptions.root,
  ]);

  // 컴포넌트 언마운트 시 정리
  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    };
  }, []);

  return { sentinelRef };
};

export default useInfiniteScroll;
