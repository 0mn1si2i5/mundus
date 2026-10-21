// Beck et al. (2023) Köppen-Geiger maps, version 2 on figshare. --capture
// reports the archive identity for review; ordinary builds reject an archive
// until its SHA-256 and size are pinned here, and reject any later change.
export const SOURCE = {
  id: 'beck-koppen-geiger-v2',
  citation:
    'Beck, H.E., McVicar, T.R., Vergopolan, N., Berg, A., Lutsko, N.J., Dufour, A., Zeng, Z., Jiang, X., van Dijk, A.I.J.M. & Miralles, D.G. (2023). High-resolution (1 km) Köppen-Geiger maps for 1901–2099 based on constrained CMIP6 projections. Scientific Data 10, 724.',
  paperDoi: 'https://doi.org/10.1038/s41597-023-02549-6',
  landingUrl: 'https://doi.org/10.6084/m9.figshare.21789074',
  fileName: 'koppen_geiger_tif.zip',
  distributionUrl: null,
  licence: 'CC BY 4.0',
  licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
  period: '1991-2020',
  member: /(^|\/)1991_2020\/koppen_geiger_0p1\.tif$/,
  legend: /(^|\/)legend\.txt$/,
  bytes: null,
  sha256: null,
  retrievedAt: null,
};
