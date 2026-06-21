/* 前端运行时配置。换 token 只改这一个文件。
   MAPBOX_TOKEN:Mapbox public token(pk. 开头),用于卫星图高清瓦片。
   这是 public token,本来就会暴露在前端 —— 请到 account.mapbox.com 给它加 URL(域名)限制,
   只允许本应用的生产域名,防止被盗用额度。留空字符串则默认回退到免费 Esri 卫星图。 */
window.APP_CONFIG = {
  MAPBOX_TOKEN: "pk.eyJ1IjoiZXJpY2hlY2FuIiwiYSI6ImNtcW5zN2RlcTAyaDIyc29uNDY1ODV4bDgifQ.i_XP8oH82H0MByw4aaNbow"
};
