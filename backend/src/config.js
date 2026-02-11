+import fs from "fs";
+import path from "path";
+
+function loadJson(relPath) {
+  const p = path.resolve(relPath);
+  return JSON.parse(fs.readFileSync(p, "utf8"));
+}
+
+export const config = {
+  port: Number(process.env.PORT || 10000),
+
+  integration: {
+    endpoint: process.env.INTEGRATION_ENDPOINT || "https://aetherdrive.onrender.com/api/metrics",
+    key: process.env.INTEGRATION_KEY || null
+  },
+
+  policy: loadJson("config/policy.json")
+};