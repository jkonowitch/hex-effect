CREATE TABLE projects (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL
);

CREATE TABLE tasks (
    id TEXT PRIMARY KEY NOT NULL,
    projectId TEXT NOT NULL,
    completed INTEGER NOT NULL,
    description TEXT NOT NULL,
    FOREIGN KEY (projectId) REFERENCES projects(id)
);
