export function norm(value) {
  return (value || '').toLowerCase();
}

export function matches(person, query) {
  if (!query) return true;
  const haystack = norm([
    person.no,
    person.name,
    person.nick,
    person.pos,
    person.committeeRole
  ].join(' '));
  return haystack.includes(query);
}
