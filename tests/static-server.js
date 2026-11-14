(function () {
  "use strict";

  var http = require("http");
  var fs = require("fs");
  var path = require("path");

  var root = path.join(__dirname, "..");
  var types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  };

  var server = http.createServer(function (req, res) {
    var urlPath = req.url.split("?")[0];
    if (urlPath === "/") {
      urlPath = "/index.html";
    }
    var file = path.normalize(path.join(root, urlPath));
    if (!file.startsWith(root)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    fs.readFile(file, function (err, data) {
      if (err) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
      res.end(data);
    });
  });

  var port = process.env.PORT || 8123;
  server.listen(port, function () {
    console.log("风廊摄影运行中: http://localhost:" + port + "/");
  });
})();
