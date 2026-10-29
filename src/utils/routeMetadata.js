import {
  getPublicRecipeByPath,
  getPublicRecipeDescription,
  PUBLIC_RECIPE_PATHS
} from '../features/recipes/publicRecipeCatalog.js';
import {
  getGuideByPath,
  getIngredientHubByPath,
  GUIDE_PATHS,
  INGREDIENT_HUB_PATHS
} from '../features/recipes/recipeContentHubs.js';

const SITE_ORIGIN = 'https://xn--wh1bs8l5xa003adme.com';

const PUBLIC_PAGE_METADATA = {
  '/': {
    title: '오늘뭐먹지 (FridgeMate) | 주간 저녁 식단과 장보기',
    description: '오늘뭐먹지(FridgeMate)에서 1~2인 주간 저녁 식단을 만들고, 냉장고 재료를 활용한 장보기와 실제 조리를 기록하세요. 가입과 재료 등록 없이 시작할 수 있습니다.'
  },
  '/recipes': {
    title: '냉장고 재료로 찾는 메뉴 추천 | 오늘뭐먹지',
    description: '보유 재료와 팬트리 기본 재료를 바탕으로 지금 만들기 좋은 메뉴와 필요한 재료를 확인하세요.'
  },
  '/about': {
    title: '서비스 소개 | 오늘뭐먹지',
    description: '오늘뭐먹지(FridgeMate)의 주간 저녁 식단, 장보기, 실제 조리 기록 흐름과 재료·로컬 저장 원칙을 소개합니다. 가입 없이 첫 식단을 시작하세요.'
  },
  '/contact': {
    title: '문의 | 오늘뭐먹지',
    description: '오늘뭐먹지 서비스 이용, 오류 제보, 계정 및 개인정보 관련 문의 방법을 확인하세요.'
  },
  '/privacy': {
    title: '개인정보 처리 안내 | 오늘뭐먹지',
    description: '오늘뭐먹지의 저장 정보, 서비스 분석, 광고와 쿠키, 개인정보 관련 선택 사항을 안내합니다.'
  }
};

export const PUBLIC_ROUTES = Object.freeze([
  ...Object.keys(PUBLIC_PAGE_METADATA),
  ...INGREDIENT_HUB_PATHS,
  ...GUIDE_PATHS,
  ...PUBLIC_RECIPE_PATHS
]);

const FUNCTIONAL_PATH_PATTERNS = [
  /^\/meal-plan$/,
  /^\/pilot$/,
  /^\/ingredients(?:\/.*)?$/,
  /^\/import$/,
  /^\/login$/,
  /^\/signup$/,
  /^\/account$/
];

export function getRouteMetadata(pathname = '/') {
  const publicMetadata = PUBLIC_PAGE_METADATA[pathname];

  if (publicMetadata) {
    return {
      ...publicMetadata,
      canonical: `${SITE_ORIGIN}${pathname === '/' ? '/' : pathname}`,
      indexable: true,
      notFound: false
    };
  }

  const contentHub = getIngredientHubByPath(pathname);
  if (contentHub) {
    return {
      title: contentHub.title,
      description: contentHub.description,
      canonical: new URL(pathname, SITE_ORIGIN).href,
      indexable: true,
      notFound: false,
      contentHub
    };
  }

  const guide = getGuideByPath(pathname);
  if (guide) {
    return {
      title: guide.title,
      description: guide.description,
      canonical: new URL(pathname, SITE_ORIGIN).href,
      indexable: true,
      notFound: false,
      guide
    };
  }

  const publicRecipe = getPublicRecipeByPath(pathname);
  if (publicRecipe) {
    return {
      title: `${publicRecipe.name} 재료와 만드는 법 | 오늘뭐먹지`,
      description: getPublicRecipeDescription(publicRecipe),
      canonical: new URL(pathname, SITE_ORIGIN).href,
      indexable: true,
      notFound: false,
      recipe: publicRecipe
    };
  }

  if (FUNCTIONAL_PATH_PATTERNS.some((pattern) => pattern.test(pathname))) {
    return {
      title: pathname === '/pilot' ? '식단 파일럿 참여 | 오늘뭐먹지' : pathname === '/meal-plan' ? '우리 집 주간 식단 | 오늘뭐먹지' : '오늘뭐먹지',
      description: pathname === '/pilot' ? '이 기기의 식단 파일럿 참여와 기록 내보내기, 철회를 관리하세요.' : pathname === '/meal-plan' ? '냉장고 재료와 취향으로 한 주 저녁 식단을 만들고 이 기기에 저장하세요.' : '오늘뭐먹지의 냉장고 관리 기능 화면입니다.',
      canonical: `${SITE_ORIGIN}${pathname}`,
      indexable: false,
      notFound: false
    };
  }

  return {
    title: '페이지를 찾을 수 없습니다 | 오늘뭐먹지',
    description: '요청한 페이지를 찾을 수 없습니다.',
    canonical: `${SITE_ORIGIN}${pathname}`,
    indexable: false,
    notFound: true
  };
}

export { SITE_ORIGIN };
