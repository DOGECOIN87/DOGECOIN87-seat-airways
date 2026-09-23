/**
 * The SEAT AIRLINES logo.
 *
 * Everywhere the page shows the logo — the top bar, the footer, the boarding
 * pass, the exterior view — it is the supplied vector in
 * public/seat-airlines-logo.svg, the one file, unaltered. The favicon, the app
 * icons and the house adverts are drawn from that same file too.
 *
 * The aircraft is the exception. The tail fin and the cabin's panels and
 * headrests wear the flat mark below, a single path they can tint, stitch and
 * paint into a texture, and so does the drifting pattern behind the page
 * (public/seat-airlines-mark-pattern.svg).
 */

/** The flat mark the aircraft wears, as one even-odd path on a 1536-square canvas. */
export const MARK_PATH =
  'M 670.00,826.00 L 670.00,840.00 L 676.00,854.00 L 681.00,860.00 L 688.00,865.00 L 704.00,870.00 L 1092.00,870.00 L 1104.00,867.00 L 1114.00,861.00 L 1121.00,853.00 L 1125.00,845.00 L 1127.00,835.00 L 1125.00,821.00 L 1118.00,809.00 L 1110.00,802.00 L 1093.00,796.00 L 705.00,796.00 L 693.00,799.00 L 683.00,805.00 L 675.00,814.00 Z M 407.00,556.00 L 402.00,563.00 L 397.00,576.00 L 397.00,598.00 L 504.00,969.00 L 509.00,983.00 L 522.00,1005.00 L 542.00,1023.00 L 560.00,1033.00 L 478.00,1152.00 L 476.00,1161.00 L 480.00,1167.00 L 483.00,1169.00 L 525.00,1169.00 L 531.00,1166.00 L 542.00,1152.00 L 602.00,1062.00 L 607.00,1057.00 L 616.00,1054.00 L 949.00,1055.00 L 954.00,1058.00 L 959.00,1064.00 L 1014.00,1161.00 L 1020.00,1167.00 L 1025.00,1169.00 L 1064.00,1169.00 L 1071.00,1163.00 L 1070.00,1152.00 L 1010.00,1047.00 L 1010.00,1044.00 L 1017.00,1033.00 L 1018.00,1022.00 L 1013.00,1011.00 L 1003.00,1004.00 L 642.00,1003.00 L 621.00,1000.00 L 600.00,991.00 L 588.00,982.00 L 572.00,963.00 L 562.00,940.00 L 559.00,925.00 L 551.00,901.00 L 532.00,827.00 L 529.00,820.00 L 518.00,776.00 L 513.00,762.00 L 510.00,747.00 L 503.00,726.00 L 500.00,711.00 L 497.00,704.00 L 455.00,550.00 L 451.00,544.00 L 445.00,541.00 L 434.00,541.00 L 418.00,547.00 Z M 453.00,376.00 L 447.00,386.00 L 444.00,398.00 L 444.00,409.00 L 446.00,419.00 L 516.00,645.00 L 549.00,767.00 L 552.00,774.00 L 555.00,789.00 L 559.00,799.00 L 560.00,807.00 L 565.00,821.00 L 593.00,929.00 L 600.00,943.00 L 611.00,956.00 L 631.00,969.00 L 651.00,974.00 L 1069.00,974.00 L 1085.00,968.00 L 1095.00,959.00 L 1100.00,951.00 L 1103.00,938.00 L 1100.00,920.00 L 1091.00,907.00 L 1079.00,899.00 L 1072.00,897.00 L 688.00,896.00 L 676.00,893.00 L 664.00,887.00 L 656.00,881.00 L 647.00,871.00 L 640.00,858.00 L 638.00,851.00 L 637.00,834.00 L 641.00,819.00 L 649.00,806.00 L 657.00,798.00 L 669.00,790.00 L 679.00,786.00 L 693.00,774.00 L 701.00,758.00 L 702.00,744.00 L 666.00,595.00 L 613.00,390.00 L 608.00,380.00 L 598.00,369.00 L 587.00,363.00 L 575.00,360.00 L 483.00,360.00 L 471.00,363.00 L 463.00,367.00 Z M 752.00,112.00 L 687.00,118.00 L 623.00,130.00 L 582.00,141.00 L 546.00,153.00 L 484.00,179.00 L 432.00,207.00 L 383.00,240.00 L 338.00,277.00 L 287.00,328.00 L 245.00,380.00 L 211.00,433.00 L 184.00,484.00 L 160.00,541.00 L 141.00,605.00 L 130.00,662.00 L 124.00,721.00 L 124.00,793.00 L 130.00,855.00 L 141.00,911.00 L 154.00,957.00 L 179.00,1020.00 L 212.00,1082.00 L 250.00,1138.00 L 288.00,1184.00 L 335.00,1231.00 L 381.00,1268.00 L 432.00,1302.00 L 479.00,1328.00 L 512.00,1343.00 L 541.00,1354.00 L 603.00,1372.00 L 663.00,1383.00 L 713.00,1388.00 L 787.00,1389.00 L 854.00,1383.00 L 911.00,1372.00 L 959.00,1359.00 L 992.00,1348.00 L 1039.00,1329.00 L 1095.00,1300.00 L 1144.00,1268.00 L 1197.00,1225.00 L 1235.00,1187.00 L 1267.00,1149.00 L 1306.00,1093.00 L 1328.00,1055.00 L 1344.00,1023.00 L 1364.00,974.00 L 1382.00,915.00 L 1394.00,851.00 L 1399.00,798.00 L 1399.00,728.00 L 1393.00,665.00 L 1383.00,610.00 L 1365.00,546.00 L 1340.00,483.00 L 1311.00,427.00 L 1279.00,377.00 L 1240.00,328.00 L 1195.00,282.00 L 1138.00,234.00 L 1093.00,203.00 L 1062.00,185.00 L 1028.00,168.00 L 992.00,153.00 L 929.00,133.00 L 868.00,120.00 L 805.00,113.00 Z M 736.00,163.00 L 804.00,163.00 L 858.00,168.00 L 903.00,176.00 L 942.00,186.00 L 976.00,197.00 L 1027.00,218.00 L 1077.00,245.00 L 1124.00,277.00 L 1158.00,305.00 L 1204.00,351.00 L 1239.00,394.00 L 1272.00,444.00 L 1304.00,505.00 L 1328.00,568.00 L 1343.00,623.00 L 1352.00,675.00 L 1356.00,717.00 L 1356.00,794.00 L 1352.00,837.00 L 1344.00,884.00 L 1326.00,950.00 L 1305.00,1003.00 L 1279.00,1053.00 L 1246.00,1104.00 L 1208.00,1152.00 L 1163.00,1198.00 L 1129.00,1227.00 L 1071.00,1267.00 L 1018.00,1295.00 L 970.00,1315.00 L 911.00,1333.00 L 857.00,1344.00 L 797.00,1350.00 L 725.00,1350.00 L 696.00,1348.00 L 636.00,1339.00 L 583.00,1326.00 L 525.00,1305.00 L 470.00,1278.00 L 425.00,1250.00 L 404.00,1235.00 L 371.00,1208.00 L 327.00,1165.00 L 284.00,1113.00 L 251.00,1064.00 L 223.00,1012.00 L 204.00,967.00 L 193.00,934.00 L 185.00,904.00 L 173.00,840.00 L 168.00,784.00 L 168.00,723.00 L 174.00,662.00 L 185.00,606.00 L 201.00,553.00 L 217.00,514.00 L 236.00,476.00 L 251.00,450.00 L 279.00,408.00 L 321.00,356.00 L 361.00,316.00 L 408.00,278.00 L 457.00,246.00 L 508.00,219.00 L 557.00,199.00 L 616.00,181.00 L 676.00,169.00 Z';

/** The brand navy the flat mark is supplied on. */
export const MARK_NAVY = '#002663';

/**
 * The logo's disc, as a viewBox on the supplied file's 500-square canvas.
 * The file leaves a margin round the disc and sits it a little above centre;
 * framing the disc itself keeps a 34px badge the size of a 34px badge.
 */
export const LOGO_FRAME = '40.43 32.28 420 420';

/** Where the logo is served from, relative to the page like every other asset. */
export const logoUrl = () => `${import.meta.env.BASE_URL}seat-airlines-logo.svg`;

let markup: Promise<string> | null = null;

/**
 * The logo's own markup, fetched once. For artwork that has to carry the logo
 * inside itself — a house advert is a self-contained data URL, and an image
 * cannot reach out to a file — rather than point at it.
 */
export const logoMarkup = (): Promise<string> =>
  (markup ??= fetch(logoUrl())
    .then((res) => {
      if (!res.ok) throw new Error(`logo: ${res.status}`);
      return res.text();
    })
    /* A failed fetch is not kept, so the next caller gets another try. */
    .catch((err: unknown) => {
      markup = null;
      throw err;
    }));

interface MarkProps {
  size?: number;
  className?: string;
  /** Names the logo for assistive tech; without it the logo is decorative. */
  title?: string;
}

/** The logo, framed to its disc, at `size` pixels square. */
const Mark = ({ size = 40, className, title }: MarkProps) => (
  <svg
    viewBox={LOGO_FRAME}
    width={size}
    height={size}
    className={className}
    role={title ? 'img' : undefined}
    aria-label={title}
    aria-hidden={title ? undefined : true}
  >
    <image href={logoUrl()} width="500" height="500" />
  </svg>
);

export default Mark;
