"""Runtime UI state smoke test; does not simulate a tracked headset."""
import json
import time
from pathlib import Path
import unreal

world = unreal.EditorLevelLibrary.get_pie_worlds(False)[0]
pawn = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.AuroraMRPawn)[0]
widget = pawn.panel_widget
result = {'test': 'MR UI state transitions in desktop PIE', 'hardware_tested': False, 'checks': []}
steps = []

def choose(index, name):
    assert widget.is_menu_open()
    widget.activate_at(unreal.Vector2D(200, 464 + index * 84))
    assert widget.get_selected_option() == name
    assert not widget.is_menu_open()
    result['checks'].append('select:' + name)

def back():
    widget.activate_at(unreal.Vector2D(200, 365))
    assert widget.is_menu_open()
    result['checks'].append('return_to_menu')

steps.append(pawn.replay_panel)
for index, name in enumerate(['Conversar', 'Memórias', 'Projetos', 'Ambiente']):
    steps.append(lambda i=index, n=name: choose(i, n))
    steps.append(back)
steps.append(pawn.replay_panel)
state = {'next': time.monotonic(), 'index': 0}
out = Path(unreal.Paths.project_saved_dir()) / 'MRValidation.json'

def tick(delta):
    if time.monotonic() < state['next']:
        return
    try:
        if state['index'] == len(steps):
            result['status'] = 'passed'
            out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
            unreal.unregister_slate_post_tick_callback(handle)
            unreal.log('AURORA_MR_UI_TEST=PASS')
            return
        steps[state['index']]()
        state['index'] += 1
        state['next'] = time.monotonic() + 1.2
    except Exception as error:
        result['status'] = 'failed'
        result['error'] = str(error)
        out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        unreal.unregister_slate_post_tick_callback(handle)
        unreal.log_error('AURORA_MR_UI_TEST=' + str(error))

handle = unreal.register_slate_post_tick_callback(tick)
