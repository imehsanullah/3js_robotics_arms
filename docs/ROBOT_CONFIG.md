# Robot configuration reference

`public/robots/index.json` contains a non-empty `robots` array of config URLs. URLs beginning with `/` are resolved from the configured application base path, while relative URLs are resolved from the index. Every loaded robot ID must be unique.

All angles are radians, lengths are metres, time is seconds, velocity is radians per second, mass comes from the URDF in kilograms, and effort is newton-metres.

## Robot fields

| Field | Required | Meaning and validation |
| --- | --- | --- |
| `id` | yes | Non-empty unique registry ID; also used by the selector. |
| `name`, `shortName`, `description` | yes | Non-empty UI text. |
| `packageName`, `packagePath` | yes | URDF package name and browser URL used to resolve `package://` assets. Leading `/` paths are application-base-relative. |
| `urdfPath` | yes | Browser URL for the static arm URDF. Leading `/` paths are application-base-relative. |
| `jointSpecs` | yes | Non-empty array described below; joint names must be unique. |
| `groups` | yes | Non-empty object described below. |
| `defaultGroup` | yes | Must name a configured group. |
| `toolFrames` | yes | Non-empty map from API/UI frame aliases to URDF frame names. |
| `defaultToolFrame` | yes | Must name a `toolFrames` alias. |
| `endEffector` | no | One optional mounted end effector; multiple selection is not implemented. |
| `presets` | yes | Joint maps. `zero`, `ready`, `folded`, and `reach` are mandatory UI contracts. |
| `actions` | no | Map of keyframe actions; omitted means no actions. |
| `defaultAction` | conditional | Required and must be known when `actions` is non-empty. |
| `capabilities` | no | Feature booleans; omitted fields default to `false`. |
| `initialTarget` | yes | Finite `{ x, y, z }` Cartesian target. |
| `camera` | yes | Finite `position` and `target` vectors. |

Unknown extra properties are ignored, but removed legacy properties (`rootLink`, `linkChain`, `downstreamLinks`, collision-pair metadata, plural `endEffectors`, and group/action nested names) have no effect and should not be present.

### `jointSpecs[]`

Each item requires:

- `name` and `label`: non-empty strings.
- `lower` and `upper`: finite limits with `lower < upper`.
- `velocity`: finite and greater than zero.
- `effort`: finite and greater than zero.

Every preset contains every configured joint exactly once. Preset and action values must be finite, known, and within that joint's range.

After the URDF loads, every configured arm joint and frame is checked against the model. An unknown URDF joint or frame fails the load instead of leaving a partial UI.

### `groups`

Each key is the group name and its value has one field:

```json
{
  "manipulator": {
    "jointNames": ["joint1", "joint2"]
  }
}
```

`jointNames` must be non-empty, unique within the group, and known to `jointSpecs`. Group labels, nested names, default frames, IK flags, and the duplicate `arm` alias are not supported.

### `endEffector`

The singular definition requires `id`, `name`, `shortName`, `packageName`, `packagePath`, `urdfPath`, `mountFrame`, and `command`.

- `mountFrame` must be a configured `toolFrames` alias.
- `origin.position` and `origin.rpy` are finite vectors and default to zero when `origin` is omitted.
- `tcpOffset` is a finite vector and defaults to zero.
- `command` requires `jointName`, finite `lower`, `upper`, `open`, `close`, and positive `velocity`; `lower < upper`, and open/close must be inside the range. `label` defaults to `Grip`.

The command joint is resolved from the end-effector URDF at runtime. The current model uses the real Robotiq mimic linkage. Synthetic contact objects, finger-link names, and motion modes are not configuration fields.

### `actions`

An action key supplies its name. The value requires a positive finite `duration`, a non-empty `keyframes` array, and optionally `label` and boolean `loop`.

Each keyframe has a finite `time` and a partial `joints` map. During normalization, keyframes are sorted once by time. Times must then be strictly increasing and inside `[0, duration]`. Joints must be known, finite, and in range. Sampling does not sort during animation.

### `capabilities`

Supported boolean flags are `supportsCollision`, `supportsInertials`, and `supportsIk`. Each defaults to `false`. Action support is derived from `actions`; fixed-base status is not configurable because the browser workbench mounts every registered arm at the scene origin.

## URDF-derived structure

Do not duplicate URDF structure in JSON. At load time the runtime:

- derives adjacent collision candidates from link and joint ancestry;
- calibrates persistent mounted-gripper linkage overlaps once at open and closed commands;
- traverses the complete mounted arm/gripper tree for inertials and total mass;
