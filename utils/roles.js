const ADMIN_OPENIDS = [
  // TODO: fill admin openid
  'ozE5v3Two0JZBRbEMq22vgcgz-Es',
  'ozE5v3eJi7NnBfMvw0Arc6Ye1iQo'
];

const COACH_OPENIDS = [
  // TODO: fill coach openid
];

function getRoleByOpenid(openid) {
  if (ADMIN_OPENIDS.includes(openid)) {
    return 'admin';
  }
  if (COACH_OPENIDS.includes(openid)) {
    return 'coach';
  }
  return 'user';
}

module.exports = {
  ADMIN_OPENIDS,
  COACH_OPENIDS,
  getRoleByOpenid,
};
