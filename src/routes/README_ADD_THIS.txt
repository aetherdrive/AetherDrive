Add these in server.js:
import complianceRouter from "./routes/compliance.js";
import { requestContext } from "./middleware/requestContext.js";

app.use(requestContext);
app.use("/api/compliance", complianceRouter);
