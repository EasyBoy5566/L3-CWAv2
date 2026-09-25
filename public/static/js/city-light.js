// Light and weather for Google's photographed cities.
//
// The photographs keep the light of the day they were taken, and their
// material is unlit, so Cesium's sun does nothing to them. The shader here
// relights them from the sun's height at each point: as photographed in full
// day, gold at dusk, rose at dawn, a dim blue at night. A light touch of
// direction (walls facing a low sun brighter) comes from each triangle's own
// facing, since the mesh has no normals. The weather at the nearest station
// is laid over it: overcast greys and dims, fog closes in, rain falls.
/* global Cesium */

const LIGHT = `
void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
  vec3 up = normalize(fsInput.attributes.positionWC);
  float altitude = dot(up, czm_sunDirectionWC); // sine of the sun's altitude
  vec3 east = normalize(cross(vec3(0.0, 0.0, 1.0), up));
  float morning = step(0.0, dot(czm_sunDirectionWC, east));

  float lit = smoothstep(-0.12, -0.01, altitude); // 0 at night, 1 from the horizon up
  float day = smoothstep(0.03, 0.32, altitude);   // 1 in full daylight
  vec3 twilight = mix(vec3(1.0, 0.68, 0.44) * 0.8, vec3(0.94, 0.76, 0.82) * 0.84, morning);
  vec3 tint = mix(vec3(0.15, 0.19, 0.31), twilight, lit);
  tint = mix(tint, vec3(1.0), day);

  // Each triangle's facing, turned towards the camera.
  vec3 p = fsInput.attributes.positionEC;
  vec3 normal = normalize(cross(dFdx(p), dFdy(p)));
  if (dot(normal, -p) < 0.0) normal = -normal;
  float facing = clamp(dot(normal, czm_sunDirectionEC), 0.0, 1.0);
  float direction = 0.3 * lit * (1.0 - 0.5 * day) * (1.0 - u_overcast);
  tint *= 1.0 + direction * (facing * 2.0 - 1.0);
  tint += direction * facing * (1.0 - day) * vec3(0.3, 0.14, 0.0);

  vec3 colour = material.diffuse * tint;
  float grey = dot(colour, vec3(0.299, 0.587, 0.114));
  colour = mix(colour, vec3(grey), 0.45 * u_overcast) * (1.0 - 0.22 * u_overcast);
  float fog = u_fog * (1.0 - exp(-length(p) / 1200.0));
  vec3 fogColour = vec3(0.7, 0.73, 0.76) * (0.12 + 0.88 * dot(tint, vec3(0.3333)));
  material.diffuse = mix(colour, fogColour, fog);
}
`;

// Slanted streaks falling across the screen, lit by what lies behind them.
const RAIN = `
uniform sampler2D colorTexture;
uniform float u_time;
uniform float u_strength;
in vec2 v_textureCoordinates;

float hash(float x) { return fract(sin(x * 133.3) * 13.13); }

void main(void) {
  vec4 scene = texture(colorTexture, v_textureCoordinates);
  vec2 resolution = czm_viewport.zw;
  vec2 uv = (gl_FragCoord.xy * 2.0 - resolution) / min(resolution.x, resolution.y);
  float a = -0.18;
  uv = mat2(cos(a), -sin(a), sin(a), cos(a)) * uv;
  uv *= length(uv + vec2(0.0, 4.9)) * 0.3 + 1.0;
  float v = 1.0 - sin(hash(floor(uv.x * 100.0)) * 2.0);
  float threshold = 0.95 + 0.03 * (1.0 - u_strength);
  float streak = clamp(abs(sin(20.0 * u_time * v + uv.y * (5.0 / (2.0 + v)))) - threshold, 0.0, 1.0) * 20.0;
  float light = 0.35 + 0.65 * dot(scene.rgb, vec3(0.299, 0.587, 0.114));
  vec3 colour = scene.rgb * (1.0 - 0.18 * u_strength) + vec3(0.72, 0.8, 0.9) * v * streak * light * 0.45 * u_strength;
  out_FragColor = vec4(colour, scene.a);
}
`;

// What each weather kind (icons.js kindFromText) does to the city.
export const WEATHER = {
  clear: { overcast: 0, fog: 0, rain: 0 },
  partly: { overcast: 0.2, fog: 0, rain: 0 },
  cloudy: { overcast: 0.6, fog: 0.1, rain: 0 },
  fog: { overcast: 0.4, fog: 0.65, rain: 0 },
  rain: { overcast: 0.75, fog: 0.25, rain: 0.6 },
  thunder: { overcast: 0.9, fog: 0.3, rain: 1 },
};

export function cityShader() {
  return new Cesium.CustomShader({
    lightingModel: Cesium.LightingModel.UNLIT,
    uniforms: {
      u_overcast: { type: Cesium.UniformType.FLOAT, value: 0 },
      u_fog: { type: Cesium.UniformType.FLOAT, value: 0 },
    },
    fragmentShaderText: LIGHT,
  });
}

/** Rain over the whole view; it animates only while it is shown. */
export class Rain {
  constructor(scene) {
    this.scene = scene;
    this.strength = 0;
    this.stage = scene.postProcessStages.add(new Cesium.PostProcessStage({
      fragmentShader: RAIN,
      uniforms: { u_time: () => (performance.now() / 1000) % 1000, u_strength: () => this.strength },
    }));
    this.stage.enabled = false;
    this.frame = null;
  }

  show(strength) {
    this.strength = strength;
    const on = strength > 0;
    this.stage.enabled = on;
    // The scene renders only on request; falling rain needs every frame.
    if (on && !this.frame) {
      const tick = () => {
        this.scene.requestRender();
        this.frame = this.stage.enabled ? requestAnimationFrame(tick) : null;
      };
      this.frame = requestAnimationFrame(tick);
    }
    this.scene.requestRender();
  }
}
