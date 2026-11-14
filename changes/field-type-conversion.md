---
type: fix
audience: admins
---
Changing a field's type now converts the values documents already hold, such as a VLAN typed as text becoming a number. A value that doesn't fit the new type is kept as it was, and the doc type page says how many.
