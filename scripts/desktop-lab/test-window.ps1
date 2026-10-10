# A throwaway window for testing the desktop tools: never the person's own programs (a test on Notepad
# replaced a real file's tab, 09/10/2026). Title passed in, so the test finds only this window.
param([string]$Title = "Aurora Teste")
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.Text = $Title
$form.Width = 460; $form.Height = 420; $form.StartPosition = 'CenterScreen'
$label = New-Object System.Windows.Forms.Label; $label.Text = 'Cadastro de cliente'; $label.Left = 20; $label.Top = 15; $label.Width = 300
$nameLabel = New-Object System.Windows.Forms.Label; $nameLabel.Text = 'Nome'; $nameLabel.Left = 20; $nameLabel.Top = 50; $nameLabel.Width = 60
$name = New-Object System.Windows.Forms.TextBox; $name.Name = 'Nome'; $name.AccessibleName = 'Nome do cliente'; $name.Left = 90; $name.Top = 47; $name.Width = 300
$city = New-Object System.Windows.Forms.ComboBox; $city.AccessibleName = 'Cidade'; $city.Left = 90; $city.Top = 85; $city.Width = 200; $city.DropDownStyle = 'DropDownList'
[void]$city.Items.AddRange(@('Salvador', 'Feira de Santana', 'Recife'))
$vip = New-Object System.Windows.Forms.CheckBox; $vip.Text = 'Cliente VIP'; $vip.Left = 90; $vip.Top = 125; $vip.Width = 200
$save = New-Object System.Windows.Forms.Button; $save.Text = 'Salvar'; $save.Left = 90; $save.Top = 165; $save.Width = 100
$status = New-Object System.Windows.Forms.Label; $status.Text = 'Nada salvo'; $status.Left = 20; $status.Top = 215; $status.Width = 400
$save.Add_Click({ $status.Text = "Salvo: $($name.Text) | $($city.SelectedItem) | VIP=$($vip.Checked)" })
$grid = New-Object System.Windows.Forms.DataGridView; $grid.AccessibleName = 'Pedidos'; $grid.Left = 20; $grid.Top = 245; $grid.Width = 400; $grid.Height = 110; $grid.AllowUserToAddRows = $false
[void]$grid.Columns.Add('Pedido', 'Pedido'); [void]$grid.Columns.Add('Cliente', 'Cliente'); [void]$grid.Columns.Add('Valor', 'Valor')
[void]$grid.Rows.Add('PC-101', 'Padaria Pao Dourado', '1500.00'); [void]$grid.Rows.Add('PC-102', 'Hotel Litoral Norte', '820.50'); [void]$grid.Rows.Add('PC-103', 'Mercadinho Sao Jorge', '310.00')
$form.Controls.AddRange(@($label, $nameLabel, $name, $city, $vip, $save, $status, $grid))
[void]$form.ShowDialog()
