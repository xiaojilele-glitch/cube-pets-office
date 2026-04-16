/**
 * CDN Asset URLs for 3D models and PDF pages
 * Design: Scandinavian Warm Minimalism — Cozy Study Room
 */

const CDN_BASE =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663463426375/NKkQA3NRgoJFshsk6jL45U";
const localAsset = (path: string) => {
  const normalizedBase =
    import.meta.env.BASE_URL === "/"
      ? "/"
      : import.meta.env.BASE_URL.replace(/\/+$/, "/");
  const normalizedPath = path.replace(/^\/+/, "");
  return encodeURI(`${normalizedBase}${normalizedPath}`);
};

export const PET_MODELS = {
  bunny: localAsset("/kenney_cube-pets_1.0/Models/GLB format/animal-bunny.glb"),
  cat: localAsset("/kenney_cube-pets_1.0/Models/GLB format/animal-cat.glb"),
  caterpillar: localAsset(
    "/kenney_cube-pets_1.0/Models/GLB format/animal-caterpillar.glb"
  ),
  chick: localAsset("/kenney_cube-pets_1.0/Models/GLB format/animal-chick.glb"),
  cow: localAsset("/kenney_cube-pets_1.0/Models/GLB format/animal-cow.glb"),
  dog: localAsset("/kenney_cube-pets_1.0/Models/GLB format/animal-dog.glb"),
  elephant: localAsset(
    "/kenney_cube-pets_1.0/Models/GLB format/animal-elephant.glb"
  ),
  fish: localAsset("/kenney_cube-pets_1.0/Models/GLB format/animal-fish.glb"),
  giraffe: localAsset(
    "/kenney_cube-pets_1.0/Models/GLB format/animal-giraffe.glb"
  ),
  hog: localAsset("/kenney_cube-pets_1.0/Models/GLB format/animal-hog.glb"),
  lion: localAsset("/kenney_cube-pets_1.0/Models/GLB format/animal-lion.glb"),
  monkey: localAsset(
    "/kenney_cube-pets_1.0/Models/GLB format/animal-monkey.glb"
  ),
  parrot: localAsset(
    "/kenney_cube-pets_1.0/Models/GLB format/animal-parrot.glb"
  ),
  pig: localAsset("/kenney_cube-pets_1.0/Models/GLB format/animal-pig.glb"),
  tiger: localAsset("/kenney_cube-pets_1.0/Models/GLB format/animal-tiger.glb"),
} as const;

export const FURNITURE_MODELS = {
  desk: localAsset("/kenney_furniture-kit/Models/GLTF format/desk.glb"),
  chairDesk: localAsset(
    "/kenney_furniture-kit/Models/GLTF format/chairDesk.glb"
  ),
  chairRounded: localAsset(
    "/kenney_furniture-kit/Models/GLTF format/chairRounded.glb"
  ),
  chairModernCushion: localAsset(
    "/kenney_furniture-kit/Models/GLTF format/chairModernCushion.glb"
  ),
  computerScreen: localAsset(
    "/kenney_furniture-kit/Models/GLTF format/computerScreen.glb"
  ),
  computerKeyboard: localAsset(
    "/kenney_furniture-kit/Models/GLTF format/computerKeyboard.glb"
  ),
  computerMouse: localAsset(
    "/kenney_furniture-kit/Models/GLTF format/computerMouse.glb"
  ),
  coatRackStanding: localAsset(
    "/kenney_furniture-kit/Models/GLTF format/coatRackStanding.glb"
  ),
  laptop: localAsset("/kenney_furniture-kit/Models/GLTF format/laptop.glb"),
  bookcaseOpen: localAsset(
    "/kenney_furniture-kit/Models/GLTF format/bookcaseOpen.glb"
  ),
  bookcaseOpenLow: localAsset(
    "/kenney_furniture-kit/Models/GLTF format/bookcaseOpenLow.glb"
  ),
  floorCornerRound: localAsset(
    "/kenney_furniture-kit/Models/GLTF format/floorCornerRound.glb"
  ),
  floorFull: localAsset(
    "/kenney_furniture-kit/Models/GLTF format/floorFull.glb"
  ),
  floorHalf: localAsset(
    "/kenney_furniture-kit/Models/GLTF format/floorHalf.glb"
  ),
  books: localAsset("/kenney_furniture-kit/Models/GLTF format/books.glb"),
  lampRoundTable: localAsset(
    "/kenney_furniture-kit/Models/GLTF format/lampRoundTable.glb"
  ),
  lampRoundFloor: localAsset(
    "/kenney_furniture-kit/Models/GLTF format/lampRoundFloor.glb"
  ),
  lampWall: localAsset("/kenney_furniture-kit/Models/GLTF format/lampWall.glb"),
  paneling: localAsset("/kenney_furniture-kit/Models/GLTF format/paneling.glb"),
  tableCoffee: localAsset(
    "/kenney_furniture-kit/Models/GLTF format/tableCoffee.glb"
  ),
  tableCoffeeSquare: localAsset(
    "/kenney_furniture-kit/Models/GLTF format/tableCoffeeSquare.glb"
  ),
  tableRound: localAsset(
    "/kenney_furniture-kit/Models/GLTF format/tableRound.glb"
  ),
  sideTable: localAsset(
    "/kenney_furniture-kit/Models/GLTF format/sideTable.glb"
  ),
  rugRounded: localAsset(
    "/kenney_furniture-kit/Models/GLTF format/rugRounded.glb"
  ),
  rugRectangle: localAsset(
    "/kenney_furniture-kit/Models/GLTF format/rugRectangle.glb"
  ),
  plantSmall1: localAsset(
    "/kenney_furniture-kit/Models/GLTF format/plantSmall1.glb"
  ),
  plantSmall2: localAsset(
    "/kenney_furniture-kit/Models/GLTF format/plantSmall2.glb"
  ),
  plantSmall3: localAsset(
    "/kenney_furniture-kit/Models/GLTF format/plantSmall3.glb"
  ),
  pottedPlant: localAsset(
    "/kenney_furniture-kit/Models/GLTF format/pottedPlant.glb"
  ),
  loungeChair: localAsset(
    "/kenney_furniture-kit/Models/GLTF format/loungeChair.glb"
  ),
  loungeSofa: localAsset(
    "/kenney_furniture-kit/Models/GLTF format/loungeSofa.glb"
  ),
  loungeSofaLong: localAsset(
    "/kenney_furniture-kit/Models/GLTF format/loungeSofaLong.glb"
  ),
  wall: localAsset("/kenney_furniture-kit/Models/GLTF format/wall.glb"),
  wallCorner: localAsset(
    "/kenney_furniture-kit/Models/GLTF format/wallCorner.glb"
  ),
  wallCornerRond: localAsset(
    "/kenney_furniture-kit/Models/GLTF format/wallCornerRond.glb"
  ),
  wallDoorway: localAsset(
    "/kenney_furniture-kit/Models/GLTF format/wallDoorway.glb"
  ),
  wallDoorwayWide: localAsset(
    "/kenney_furniture-kit/Models/GLTF format/wallDoorwayWide.glb"
  ),
  wallHalf: localAsset("/kenney_furniture-kit/Models/GLTF format/wallHalf.glb"),
  wallWindow: localAsset(
    "/kenney_furniture-kit/Models/GLTF format/wallWindow.glb"
  ),
  wallWindowSlide: localAsset(
    "/kenney_furniture-kit/Models/GLTF format/wallWindowSlide.glb"
  ),
} as const;

export const PDF_PAGES: string[] = Array.from({ length: 33 }, (_, i) => {
  const pageNum = i + 1;
  const hashes: Record<number, string> = {
    1: "c2fa7579",
    2: "3483b27d",
    3: "496bf231",
    4: "91d0b15a",
    5: "73608be7",
    6: "7161f695",
    7: "18351c12",
    8: "738fe546",
    9: "c4007206",
    10: "fbda0475",
    11: "07d50059",
    12: "d30ba708",
    13: "73fa0afd",
    14: "5444e685",
    15: "6ed845aa",
    16: "c0fe8eb7",
    17: "539c7276",
    18: "a02ce81c",
    19: "18417515",
    20: "9aeebc4b",
    21: "ba06c226",
    22: "e0e5ba8c",
    23: "3d107a41",
    24: "b846ac7c",
    25: "d147585e",
    26: "84d099df",
    27: "baa11a1b",
    28: "43a51cf7",
    29: "3e9f06ba",
    30: "aa922d69",
    31: "d473896a",
    32: "0235de26",
    33: "dd52218a",
  };
  return `${CDN_BASE}/page_${pageNum}_${hashes[pageNum]}.png`;
});

export const PDF_TOTAL_PAGES = 33;

export const PDF_TITLE =
  "从单一指令到全组织行动：面向多智能体 LLM 系统的组织镜像方法";
export const PDF_AUTHOR = "金永勋 (Yongxun Jin)";
