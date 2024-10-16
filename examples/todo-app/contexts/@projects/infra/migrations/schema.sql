
--
-- LibSQL SQL Schema dump automatic generated by geni
--

CREATE TABLE hex_effect_events (
        message_id TEXT PRIMARY KEY NOT NULL,
        occurred_on DATETIME NOT NULL,
        delivered INTEGER NOT NULL DEFAULT 0,
        payload TEXT NOT NULL
      );
CREATE TABLE schema_migrations (id VARCHAR(255) NOT NULL PRIMARY KEY);
CREATE TABLE projects (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL);
CREATE TABLE tasks (id TEXT PRIMARY KEY NOT NULL, projectId TEXT NOT NULL, completed INTEGER NOT NULL, description TEXT NOT NULL, FOREIGN KEY (projectId) REFERENCES projects (id));